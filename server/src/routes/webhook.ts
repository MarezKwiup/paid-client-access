import express, { Router } from 'express';
import type Stripe from 'stripe';
import type { Logger } from 'pino';
import { z } from 'zod';
import { env } from '../config/env.js';
import { stripe, supabaseAdmin } from '../lib/clients.js';
import { syncPurchaseToZoho } from '../services/crmSync.js';

type FulfilResult = {
    purchase_id: string;
    newly_paid: boolean;
    status: string;
    zoho_deal_id: string | null;
    crm_sync_status: 'pending' | 'synced' | 'failed' | null;
};

const UNMATCHABLE = ['purchase_not_found', 'session_mismatch', 'amount_mismatch'];

export const webhookRouter = Router();

// webhook endpoint
webhookRouter.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.header('stripe-signature');
    if (!signature) {
        res.status(400).send('Missing stripe signature header');
        return;
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        req.log.warn({ err }, 'Rejected webhook with invalid signature');
        res.status(400).send('Invalid signature');
        return;
    }

    const log = req.log.child({ stripeEventId: event.id, stripeEventType: event.type });

    // already seen event
    const { data: seen, error: seenErr } = await supabaseAdmin
        .from('stripe_events')
        .select('processed_at')
        .eq('event_id', event.id)
        .maybeSingle();
    if (seenErr) throw seenErr;
    if (seen?.processed_at) {
        log.info('Duplicate event, already processed');
        res.json({ received: true, duplicate: true });
        return;
    }

    let purchaseToSync: string | null = null;

    switch (event.type) {
        case 'checkout.session.completed' :
        case 'checkout.session.async_payment_succeeded':
            purchaseToSync = await handlePaidSession(event, event.data.object, log);
            break;
        
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed':
            await retirePurchase(event, event.data.object, log);
            break;
        
        default:
            log.info('Event type not handled, acknowledging');
            await recordEvent(event);
    }

    // Acknowledge the payment
    res.json({ received: true });

    if (purchaseToSync) {
        syncPurchaseToZoho(purchaseToSync, log).catch((err) => 
            log.error({ err, purchaseId: purchaseToSync }, 'Inline CRM sync failed; retry worker will pick it up'),
        );
    }
})

async function handlePaidSession(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
    log: Logger,
): Promise<string | null> {
    if (session.payment_status !== 'paid') {
        log.info({ paymentStatus: session.payment_status }, 'Session completed but not paid yet');
        await recordEvent(event);
        return null;
    }

    const purchaseId = parsePurchaseId(session);
    if (!purchaseId) {
        log.warn('No valid purchase_id in metadata, ignoring');
        return null;
    }

    const paymentIntentId =
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntentId || session.amount_total == null || !session.currency) {
        log.error({ purchaseId }, 'Paid session missing payment intent / amount, needs review');
        return null;
    }

    const { data, error } = await supabaseAdmin.rpc('fulfil_purchase', {
        p_purchase_id: purchaseId,
        p_session_id: session.id,
        p_payment_intent_id: paymentIntentId,
        p_amount_minor: session.amount_total,
        p_currency: session.currency,
        p_event_id: event.id,
        p_event_type: event.type,
    });

    if (error) {
        if (UNMATCHABLE.some((code) => error.message.startsWith(code))) {
            // Retrying wont fix this.
            log.error({ err: error, purchaseId }, 'Payment could not be matched to a purchase, needs review');
            await recordEvent(event);
            return null;
        }
        throw error;
    }

    const result = data as unknown as FulfilResult;
    log.info({ purchaseId, newlyPaid: result.newly_paid, crm: result.crm_sync_status }, 'Purchase fulfilled');

    return result.crm_sync_status === 'pending' ? purchaseId : null;
}

async function recordEvent(event: Stripe.Event) {
    const { error } = await supabaseAdmin
        .from('stripe_events')
        .upsert(
            { event_id: event.id, type: event.type, processed_at: new Date().toISOString() },
            { onConflict: 'event_id', ignoreDuplicates: true },
        );
    if (error) throw error;
}

function parsePurchaseId(session: Stripe.Checkout.Session): string | null {
    const parsed = z.string().uuid().safeParse(session.metadata?.purchase_id);
    return parsed.success ? parsed.data : null;
}

async function retirePurchase(event: Stripe.Event, session: Stripe.Checkout.Session, log: Logger) {
    const purchaseId = parsePurchaseId(session);
    if (purchaseId) {
        const { error } = await supabaseAdmin
            .from('purchases')
            .update({ status: 'expired' })
            .eq('id', purchaseId)
            .eq('status', 'pending');
        if (error) throw error;
        log.info({ purchaseId }, 'Pending purchase retired');
    }
    await recordEvent(event);
}