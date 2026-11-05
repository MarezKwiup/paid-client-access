-- =====================================================================
-- seed.sql: sample data for local/dev testing. Safe to re-run.
-- Requires the two auth users to exist first (created in the dashboard).
-- =====================================================================

-- ---------- clients ----------
insert into public.clients (id, full_name, email, zoho_contact_id) values
    ('3f3b58ed-b130-48f0-8d31-6398d84f6d81', 'Client A', 'client-a@test.com', '1471028000000481529'),
    ('43d66ad2-0241-4ae6-a305-61625ff5de2d', 'Client B', 'client-b@test.com', '1471028000000481552')
on conflict (id) do nothing;

-- ---------- documents ----------
-- Fixed UUID so deals below (and docs/tests) can reference it.
insert into public.documents (id, title, description, storage_path, price_minor, currency) values
    ('00000000-0000-4000-8000-000000000001',
    'Sample Document',
    'A sample PDF unlocked after payment',
    'sample-document.pdf',
    49900,
    'inr')
on conflict (id) do nothing;

-- ---------- deals: client + document -> Zoho Deal ----------
insert into public.deals (client_id, document_id, zoho_deal_id) values
    ('3f3b58ed-b130-48f0-8d31-6398d84f6d81', '00000000-0000-4000-8000-000000000001', '1471028000000481563'),
    ('43d66ad2-0241-4ae6-a305-61625ff5de2d', '00000000-0000-4000-8000-000000000001', '1471028000000481571')
on conflict (zoho_deal_id) do nothing;
