-- =====================================================================
-- refunds: revoke access + queue CRM update when a payment is fully refunded.
-- =====================================================================

alter table public.purchases add column refunded_at timestamptz;

alter table public.crm_syncs
    add column action text not null default 'mark_paid'
    check (action in ('mark_paid', 'mark_refunded'));

create or replace function public.refund_purchase(
    p_purchase_id uuid,
    p_payment_intent_id text,
    p_event_id text,
    p_event_type text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_purchase public.purchases%rowtype;
    v_newly_refunded boolean := false;
    v_access_revoked boolean := false;
begin
  -- Same lock as fulfil_purchase: a refund and a late "completed" event
  -- for the same purchase can never interleave.
  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'purchase_not_found: %', p_purchase_id;
  end if;

  if v_purchase.stripe_payment_intent_id is not null
    and v_purchase.stripe_payment_intent_id <> p_payment_intent_id then
    raise exception 'payment_intent_mismatch: purchase %', p_purchase_id;
  end if;

  if v_purchase.status <> 'refunded' then
    -- Also covers pending/expired: if the refund beat checkout.session.completed,
    -- the late completed event becomes a no-op and access is never granted.
    update public.purchases
        set status = 'refunded',
            refunded_at = now(),
            stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id)
        where id = p_purchase_id;
    
    v_newly_refunded := true;

    -- Revoke, don't delete: keeps the audit trail.
    update public.entitlements
    set revoked_at = now()
    where purchase_id = p_purchase_id
        and revoked_at is null;
    v_access_revoked := found;

    -- Only purchases the CRM was told about have a sync row.
    -- greatest(): never cut into an in-flight "mark paid" lease.
    update public.crm_syncs
    set action = 'mark_refunded',
        status = 'pending',
        attempts = 0,
        last_error = null,
        synced_at = null,
        next_attempt_at = greatest(next_attempt_at, now())
    where purchase_id = p_purchase_id;
  end if;

  insert into public.stripe_events as se (event_id, type, processed_at)
  values (p_event_id, p_event_type, now())
  on conflict (event_id) do update
    set processed_at = coalesce(se.processed_at, now());

  return jsonb_build_object(
    'purchase_id', p_purchase_id,
    'newly_refunded', v_newly_refunded,
    'access_revoked', v_access_revoked,
    'crm_sync_status', (select c.status from public.crm_syncs c where c.purchase_id = p_purchase_id)
  );    
end;
$$;

revoke execute on function public.refund_purchase(uuid, text, text, text)
    from public, anon, authenticated;
grant execute on function public.refund_purchase(uuid, text, text, text)
    to service_role;