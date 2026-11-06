import { useState } from "react";
import { api, messageOf } from '../lib/api';
import { formatMoney } from "../lib/format";
import type { PortalItem } from "../hooks/usePortalData";

const PAYMENT_LABEL: Record<string, string> = {
    pending: 'Checkout started',
    paid: 'Paid',
    expired: 'Checkout expired',
    refunded: 'Refunded',
};

const CRM_LABEL: Record<string, { text: string; tone: string}> = {
    synced: { text: 'Recorded', tone: 'ok' },
    pending: { text: 'Syncing...', tone: 'warn' },
    failed: { text: 'Delayed, our team is on it', tone: 'bad' },
};

export function DealCard({ item, onError }: { item: PortalItem; onError: (msg: string) => void}) {
    const [busy, setBusy] = useState<'buy' | 'download' | null>(null);
    const { document: doc, hasAccess, latestPurchase: p } = item;
    const paidButNotUnlocked = !hasAccess && p?.status === 'paid';
    const crm = p?.status === 'paid' && p.crm_sync ? CRM_LABEL[p.crm_sync.status] : null;

    async function buy() {
        setBusy('buy');
        try {
            const { url } = await api.startCheckout(item.dealId);
            window.location.assign(url);
        } catch (err) {
            onError(messageOf(err));
            setBusy(null);
        }
    }

    async function download() {
        setBusy('download');
        try {
            const { url } = await api.getDownloadUrl(doc.id);
            window.location.assign(url);
        } catch (err) {
            onError(messageOf(err));
        } finally {
            setBusy(null);
        }
    }

    return (
        <article className="card">
            <header className="card-head">
                <div>
                    <h2>{doc.title}</h2>
                    {doc.description && <p className="muted">{doc.description}</p>}
                </div>
                <span className="price">{formatMoney(doc.price_minor, doc.currency)}</span>
            </header>

            <dl className="status">
                <dt>Access</dt>
                <dd>
                    <span className={`badge ${hasAccess ? 'ok' : paidButNotUnlocked ? 'warn' : 'neutral'}`}>
                        { hasAccess ? 'Unlocked' : paidButNotUnlocked ? 'Processing' : 'Locked'}
                    </span>
                </dd>

                <dt>Payment</dt>
                <dd>{p ? PAYMENT_LABEL[p.status] ?? p.status : 'Not purchased'}</dd>

                {crm && (
                    <>
                        <dt>CRM record</dt>
                        <dd>
                            <span className={`badge ${crm.tone}`}>
                                {crm.text}
                            </span>
                            {crm.tone !== 'ok' && <span className="hint">Your access doesnt depend on this.</span>}
                        </dd>
                    </>
                )}
            </dl>

            <div className="actions">
                {hasAccess ? (
                    <button onClick={download} disabled={busy !== null}>
                        {busy === 'download' ? 'Preparing...' : 'Download'}
                    </button>
                ):(
                    <button onClick={buy} disabled={busy !== null || paidButNotUnlocked}>
                        { busy === 'buy' ? 'Redirecting...' : p?.status === 'pending' ? 'Resume checkout' : 'Buy'}
                    </button>
                )}
            </div>
        </article>
    );
}