import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { usePortalData } from "../hooks/usePortalData";
import { DealCard } from "./DealCard";

const POLL_MS = 2000;
const MAX_POLLS = 20;

type Notice = { tone: 'ok' | 'warn' | 'bad'; text: string };

type CheckoutParams = { checkout: string | null; sessionId: string | null };

function initialNotice({ checkout, sessionId }: CheckoutParams): Notice | null {
    if (checkout === 'cancelled') return { tone: 'warn', text: 'Checkout cancelled. You have not been charged.' };
    if (checkout === 'success' && sessionId) return { tone: 'warn', text: 'Payment received, unlocking your document...' };
    return null;
}

export function Portal({ email }: { email: string }) {
    const { items, loading, error, refresh } = usePortalData();

    // Read stripe redirect params once, during first render
    const [checkoutParams] = useState<CheckoutParams>(() => {
        const p = new URLSearchParams(window.location.search);
        return { checkout: p.get('checkout'), sessionId: p.get('session_id') };
    });
    const [notice, setNotice] = useState<Notice | null>(() => initialNotice(checkoutParams));
    
    useEffect(() => {
        window.history.replaceState(null, '', window.location.pathname);
    }, []);

    // Poll after successful checkout.
    useEffect(() => {
        const { checkout, sessionId } = checkoutParams;
        if (checkout !== 'success' || !sessionId) return;
        
        let polls = 0;
        let cancelled = false;
        const timer = setInterval(async () => {
            polls++;
            const data = await refresh();
            if (cancelled || !data) return;

            const item = data.find((i) => i.latestPurchase?.stripe_checkout_session_id === sessionId);
            const unlocked = item?.hasAccess;
            const crmSettled = item?.latestPurchase?.crm_sync?.status !== 'pending';

            if (unlocked) setNotice({ tone: 'ok', text: 'Payment confirmed, your document is unlocked.'});
            if ((unlocked && crmSettled) || polls >= MAX_POLLS) {
                clearInterval(timer);
                if (!unlocked) {
                    setNotice({ tone: 'warn', text: 'Still confirming your payment. This page will update when you refresh.' });
                }
            }
        }, POLL_MS)

        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [refresh, checkoutParams]);

    return (
        <div className="page">
            <header className="topbar">
                <strong>Client Portal</strong>
                <span className="muted">{email}</span>
                <button className="link" onClick={() => supabase.auth.signOut()}>
                    Sign out
                </button>
            </header>

            {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}
            {error && <div className="notice bad">{error}</div>}

            {loading ? (
                <p className="muted">Loading...</p>
            ): items.length === 0 ? (
                <p className="muted">No documents are assigned to your account yet.</p>
            ) : (
                <div className="grid">
                    {items.map((item) => (
                        <DealCard key={item.dealId} item={item} onError={(text) => setNotice({ tone: 'bad', text })} />
                    ))}
                </div>
            )}

            <button className="link refresh" onClick={() => void refresh()}>
                Refresh status
            </button>
        </div>
    );
}