-- =====================================================================
-- fulfil_purchase: atomically mark paid + grant entitlement + queue CRM sync.
-- Called only by the Express webhook handler (service role).
-- Safe to call any number of times for the same purchase.
-- =====================================================================

create or replace function public.fulfil_purchase(
    p_purchase_id uuid,
    p_session_id text,
    p_payment_intent_id text,
    p_amount_minor int,
    p_currency text,
    p_event_id text,
    p_event_type text
)

returns jsonb
language plpgsql
security invoker
set search_path = ''  -- no schema hijacking; every name below is qualified
as $$
declare
    v_purchase public.purchases%rowtype;
    v_zoho_deal_id text;
    v_newly_paid boolean := false;
begin
  -- 1. Lock the purchase row. Concurrent deliveries of the same payment queue up here instead of racing each other.
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found: %', p_purchase_id;
  end if;

  -- 2. Verify the payment matches what we created at checkout time.
  if v_purchase.stripe_checkout_session_id is not null
    and v_purchase.stripe_checkout_session_id <> p_session_id then
    raise exception 'session_mismatch: purchase %', p_purchase_id;
  end if;

  if v_purchase.amount_minor <> p_amount_minor
    or v_purchase.currency <> lower(p_currency) then
    raise exception 'amount_mismatch: purchase %', p_purchase_id;
  end if;

  -- 3. Only pending/expired -> paid. Already paid or refunded = no-op.
  if v_purchase.status in ('pending', 'expired') then
    update public.purchases
        set status = 'paid',
        paid_at = now(),
        stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id),
        stripe_payment_intent_id = p_payment_intent_id
    where id = p_purchase_id;

    v_newly_paid := true;

    -- 4. Grant access. If a revoked entitlement exists (refund, then re-buy), reactivate it; if an active one exists, leave it alone.
    insert into public.entitlements as e (client_id, document_id, purchase_id)
    values (v_purchase.client_id, v_purchase.document_id, p_purchase_id)
    on conflict (client_id, document_id) do update
        set revoked_at = null,
        purchase_id = excluded.purchase_id,
        granted_at = now()
        where e.revoked_at is not null;

    -- 5. Queue the Zoho update. The webhook attempts it right after commit; if that fails the row stays 'pending' for the retry worker.
    insert into public.crm_syncs (purchase_id)
    values (p_purchase_id)
    on conflict (purchase_id) do nothing;
  end if;

  -- 6. Log the event inside the same transaction, so "processed" is only ever recorded together with the work it describes.
  insert into public.stripe_events as se (event_id, type, processed_at)
  values (p_event_id, p_event_type, now())
  on conflict (event_id) do update
    set processed_at = coalesce(se.processed_at, now());

  select d.zoho_deal_id into v_zoho_deal_id
  from public.deals d
  where d.id = v_purchase.deal_id;

  return jsonb_build_object(
    'purchase_id', p_purchase_id,
    'newly_paid', v_newly_paid,
    'status', case when v_newly_paid then 'paid' else v_purchase.status end,
    'zoho_deal_id', v_zoho_deal_id,
    'crm_sync_status', (select c.status from public.crm_syncs c where c.purchase_id = p_purchase_id)
  );
end;
$$;

-- Functions in the public schema are callable through Supabase's REST API by default. Lock this one down to the server only.
revoke execute on function public.fulfil_purchase(uuid, text, text, int, text, text, text)
    from public, anon, authenticated;
grant execute on function public.fulfil_purchase(uuid, text, text, int, text, text, text)
    to service_role;
