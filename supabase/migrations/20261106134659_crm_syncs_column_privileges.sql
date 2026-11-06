-- Clients may see whether their CRM sync succeeded, not internal error details.
-- RLS limits which ROWS they see; column privileges limit which COLUMNS.
revoke select on public.crm_syncs from anon, authenticated;
grant select (purchase_id, status, synced_at) on public.crm_syncs to authenticated;