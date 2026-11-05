create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ---------- clients: profile row per Supabase auth user ----------
create table public.clients (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null,
    email text not null,
    zoho_contact_id text not null unique,
    created_at timestamptz not null default now()
);

-- ---------- documents: purchasable items ----------
create table public.documents (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    description text,
    storage_path text not null unique,
    price_minor int not null check (price_minor > 0),
    currency text not null default 'inr'
        check (currency = lower(currency) and char_length(currency) = 3),
    created_at timestamptz not null default now()
);

-- ---------- deals: stable mapping client + document -> Zoho Deal ----------
create table public.deals (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id),
    document_id uuid not null references public.documents(id),
    zoho_deal_id text not null unique,
    created_at timestamptz not null default now(),
    unique (client_id, document_id)
);
create index deals_client_id_idx on public.deals (client_id);

-- ---------- purchases: one checkout attempt ----------
create table public.purchases (
    id uuid primary key default gen_random_uuid(),
    deal_id uuid not null references public.deals(id),
    client_id uuid not null references public.clients(id),
    document_id uuid not null references public.documents(id),
    status text not null default 'pending'
        check (status in ('pending', 'paid', 'expired', 'refunded')),
    amount_minor int not null check (amount_minor > 0),
    currency text not null,
    stripe_checkout_session_id text unique,
    stripe_payment_intent_id text unique,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index purchases_client_id_idx on public.purchases (client_id);
create index purchases_deal_idx on public.purchases (deal_id);

create trigger purchases_set_updated_at
    before update on public.purchases
    for each row execute function public.set_updated_at();

-- ---------- entitlements: "client may read document" ----------
create table public.entitlements (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id),
    document_id uuid not null references public.documents(id),
    purchase_id uuid not null unique references public.purchases(id),
    granted_at timestamptz not null default now(),
    revoked_at timestamptz,
    unique (client_id, document_id)
);

-- ---------- crm_syncs: Zoho sync state, one row per purchase ----------
create table public.crm_syncs (
    purchase_id uuid primary key references public.purchases(id),
    status text not null default 'pending'
        check (status in ('pending', 'synced', 'failed')),
    attempts int not null default 0 check (attempts >= 0),
    last_error text,
    next_attempt_at timestamptz not null default now(),
    synced_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- lets the retry worker find due rows cheaply
create index crm_syncs_due_idx on public.crm_syncs (next_attempt_at) where status = 'pending';

create trigger crm_syncs_set_updated_at
    before update on public.crm_syncs
    for each row execute function public.set_updated_at();

-- ---------- stripe_events: webhook dedupe / audit log ----------
create table public.stripe_events (
    event_id text primary key,
    type text not null,
    received_at timestamptz not null default now(),
    processed_at timestamptz
);

-- RLS
alter table public.clients enable row level security;
alter table public.documents enable row level security;
alter table public.deals enable row level security;
alter table public.purchases enable row level security;
alter table public.entitlements enable row level security;
alter table public.crm_syncs enable row level security;
alter table public.stripe_events enable row level security;

-- SELECT-only policies. No insert/update/delete policies

create policy "clients: read own profile"
    on public.clients for select to authenticated
    using (id = (select auth.uid()));

create policy "documents: catalog readable by signed-in users"
    on public.documents for select to authenticated
    using (true);

create policy "deals: read own"
    on public.deals for select to authenticated
    using (client_id = (select auth.uid()));

create policy "purchases: read own"
    on public.purchases for select to authenticated
    using (client_id = (select auth.uid()));

create policy "entitlements: read own"
    on public.entitlements for select to authenticated
    using (client_id = (select auth.uid()));

create policy "crm_syncs: read own via purchase"
    on public.crm_syncs for select to authenticated
    using (exists (
        select 1 from public.purchases p
        where p.id = crm_syncs.purchase_id
        and p.client_id = (select auth.uid())
    ));









