create unique index purchases_one_pending_per_deal
  on public.purchases (deal_id)
  where status = 'pending';