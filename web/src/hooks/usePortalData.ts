import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { messageOf } from '../lib/api';

export type PortalItem = {
  dealId: string;
  document: { id: string; title: string; description: string | null; price_minor: number; currency: string };
  hasAccess: boolean;
  latestPurchase: {
    id: string;
    status: string;
    paid_at: string | null;
    stripe_checkout_session_id: string | null;
    crm_sync: { status: string; synced_at: string | null } | null;
  } | null;
};

// All three reads run under RLS: each client only ever receives their own rows.
async function fetchPortal(): Promise<PortalItem[]> {
  const [deals, purchases, entitlements] = await Promise.all([
    supabase
      .from('deals')
      .select('id, document:documents(id, title, description, price_minor, currency)')
      .order('created_at'),
    supabase
      .from('purchases')
      .select('id, deal_id, status, paid_at, stripe_checkout_session_id, crm_sync:crm_syncs(status, synced_at)')
      .order('created_at', { ascending: false }),
    supabase.from('entitlements').select('document_id').is('revoked_at', null),
  ]);
  if (deals.error) throw deals.error;
  if (purchases.error) throw purchases.error;
  if (entitlements.error) throw entitlements.error;

  const owned = new Set(entitlements.data.map((e) => e.document_id));

  return deals.data.flatMap((d) => {
    if (!d.document) return [];
    const latest = purchases.data.find((p) => p.deal_id === d.id) ?? null;
    return [{ dealId: d.id, document: d.document, hasAccess: owned.has(d.document.id), latestPurchase: latest }];
  });
}

export function usePortalData() {
  const [items, setItems] = useState<PortalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPortal();
      setItems(data);
      setError(null);
      return data;
    } catch (err) {
      setError(messageOf(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    fetchPortal().then(
        (data) => {
            if (ignore) return;
            setItems(data);
            setError(null);
            setLoading(false);
        },
        (err: unknown) => {
            if (ignore) return;
            setError(messageOf(err));
            setLoading(false);
        },
    );
    return () => {
        ignore = true;
    };
  }, []);

  return { items, loading, error, refresh };
}