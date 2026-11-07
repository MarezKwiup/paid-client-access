import type { Logger } from "pino";
import { supabaseAdmin } from "../lib/clients.js";
import { markDealPaid, ZohoError, markDealRefunded } from "../integrations/zoho.js";

const MAX_ATTEMPTS = 8;
const LEASE_MS = 2 * 60 * 1000;
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export function backoffMs(attempts: number): number {
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempts - 1));
    return Math.round(exp * (0.8 + Math.random() * 0.4));
}

export type SyncOutcome = 'synced' | 'retry_scheduled' | 'failed' | 'skipped';

export async function syncPurchaseToZoho(purchaseId: string, log: Logger): Promise<SyncOutcome> {
    const now = new Date();

    // 1. Claim a lease with one conditional UPDATE, so simultaneous callers can't both run this sync.
    const { data: claimed, error: claimErr } = await supabaseAdmin
        .from('crm_syncs')
        .update({ next_attempt_at: new Date(now.getTime() + LEASE_MS).toISOString() })
        .eq('purchase_id', purchaseId)
        .eq('status', 'pending')
        .lte('next_attempt_at', now.toISOString())
        .select('attempts, action')
        .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
        log.debug({ purchaseId }, 'CRM sync not due or claimed elsewhere');
        return 'skipped';
    }
    const { action } = claimed;
    const attempts = claimed.attempts + 1;

    // Load data for zoho update
    const { data: purchase, error: pErr } = await supabaseAdmin
        .from('purchases')
        .select('stripe_payment_intent_id, paid_at, deal:deals(zoho_deal_id)')
        .eq('id', purchaseId)
        .single();
    if (pErr) throw pErr;

    // Call zoho
    let failure: unknown = null;
    try {
        if (!purchase.deal) throw new ZohoError('Purchase has no linked deal', false);

        if (action === 'mark_refunded') {
            await markDealRefunded({ zohoDealId: purchase.deal.zoho_deal_id });
        } else {
            if (!purchase.stripe_payment_intent_id) {
                throw new ZohoError('Paid purchase has no payment intent', false);
            }
            await markDealPaid({
                zohoDealId: purchase.deal.zoho_deal_id,
                stripePaymentId: purchase.stripe_payment_intent_id,
                paidAt: new Date(purchase.paid_at ?? Date.now()),
            });
        }
    } catch (err) {
        failure = err;
    }

    if (!failure) {
        const { error } = await supabaseAdmin
            .from('crm_syncs')
            .update({ status: 'synced', attempts, synced_at: new Date().toISOString(), last_error: null })
            .eq('purchase_id', purchaseId)
            .eq('action', action);
        if (error) throw error;
        log.info({ purchaseId, action, attempts }, 
            action === 'mark_refunded' ? 'Zoho Deal marked refunded' : 'Zoho Deal marked paid',
        );
        return 'synced';
    }

    // On failure, back off or fail if too many attempts or not possible to succeed.
    const retriable = failure instanceof ZohoError ? failure.retriable : true;
    const message = (failure instanceof Error ? failure.message : String(failure)).slice(0, 500);
    const giveUp = !retriable || attempts >= MAX_ATTEMPTS;

    const { error } = await supabaseAdmin
        .from('crm_syncs')
        .update({
            status: giveUp ? 'failed' : 'pending',
            attempts,
            last_error: message,
            next_attempt_at: new Date(Date.now() + (giveUp ? 0 : backoffMs(attempts))).toISOString(),
        })
        .eq('purchase_id', purchaseId)
        .eq('action', action);
    if (error) throw error;

    log.warn({ purchaseId, action, attempts, retriable, giveUp, err: message }, 'Zoho sync failed');
    return giveUp ? 'failed' : 'retry_scheduled';
}

export async function processDueSyncs(log: Logger, limit = 10) {
    const { data, error } = await supabaseAdmin
        .from('crm_syncs')
        .select('purchase_id')
        .eq('status', 'pending')
        .lte('next_attempt_at', new Date().toISOString())
        .order('next_attempt_at', { ascending: true })
        .limit(limit)
    if (error) throw error;

    const results: Record<SyncOutcome, number> = { synced: 0, retry_scheduled: 0, failed: 0, skipped: 0 };
    for (const row of data) {
        try {
            results[await syncPurchaseToZoho(row.purchase_id, log)]++;
        } catch (err) {
            log.error({ err, purchaseId: row.purchase_id }, 'CRM sync attempt crashed');
        }
    }
    return results;
}

// Move failed rows back to pending.
export async function requeueFailedSync(purchaseId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from('crm_syncs')
        .update({ status: 'pending', next_attempt_at: new Date().toISOString() })
        .eq('purchase_id', purchaseId)
        .eq('status', 'failed')
        .maybeSingle()

    if (error) throw error;
    return data !== null;
}