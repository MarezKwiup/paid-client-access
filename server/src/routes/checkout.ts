import { Router } from "express";
import { z } from 'zod';
import { env } from "../config/env.js";
import { stripe, supabaseAdmin } from '../lib/clients.js';
import { AppError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";

const bodySchema = z.object({ dealId: z.string().uuid() });
const SESSION_TTL_SECONDS = 30 * 60;

export const checkoutRouter = Router();

checkoutRouter.post('/', requireAuth, async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        throw new AppError(400, 'invalid_request', 'dealId must be UUID');
    }
    const { dealId } = parsed.data;
    const user = req.user!;

    const { data: deal, error: dealErr } = await supabaseAdmin
        .from('deals')
        .select('id, document:documents(id, title, price_minor, currency)')
        .eq('id', dealId)
        .eq('client_id', user.id)
        .maybeSingle();
    if (dealErr) throw dealErr;
    if (!deal?.document) {
        throw new AppError(404, 'deal_not_found', 'Deal not found');
    }
    const doc = deal.document;

    const { data: owned, error: ownedErr } = await supabaseAdmin
        .from('entitlements')
        .select('id')
        .eq('client_id', user.id)
        .eq('document_id', doc.id)
        .is('revoked_at', null)
        .maybeSingle();
    if (ownedErr) throw ownedErr;
    if (owned) {
        throw new AppError(409, 'already owned', 'You already have access to this document');
    }

    const { data: pending, error: pendingErr } = await supabaseAdmin
        .from('purchases')
        .select('id, stripe_checkout_session_id')
        .eq('deal_id', deal.id)
        .eq('status', 'pending')
        .maybeSingle();
    if (pendingErr) throw pendingErr;
    
    // Reuse or retire an existing pending checkout.
    if (pending) {
        if (pending.stripe_checkout_session_id) {
            const existing = await stripe.checkout.sessions.retrieve(pending.stripe_checkout_session_id);
            if (existing.status === 'open' && existing.url) {
                res.json({ url: existing.url, purchaseId: pending.id, reused: true });
                return;
            }
            if (existing.status === 'complete') {
                // Paid (or async payment settling). The webhook will grant access.
                throw new AppError(409, 'payment_processing', 'Payment received, access is being granted');
            }
        }

        // Session expired, or session creation never finished: retire it.
        // fulfil_purchase still accepts 'expired' -> 'paid', so a late payment is never lost.
        const { error } = await supabaseAdmin
            .from('purchases')
            .update({ status: 'expired' })
            .eq('id', pending.id)
            .eq('status', 'pending');
        if (error) throw error;
    }

    // Create purchase row
    const { data: purchase, error: insertErr } = await supabaseAdmin
        .from('purchases')
        .insert({
            deal_id: deal.id,
            client_id: user.id,
            document_id: doc.id,
            amount_minor: doc.price_minor,
            currency: doc.currency
        })
        .select('id')
        .single();
    if (insertErr) {
        if (insertErr.code === '23505') {
            throw new AppError(409, 'checkout_in_progress', 'A checkout is already being created, please retry');
        }
        throw insertErr;
    }

    // Create stripe checkout session
    const metadata = { purchase_id: purchase.id, client_id: user.id, deal_id: deal.id };
    let session;
    try {
        session = await stripe.checkout.sessions.create(
            {
                mode: 'payment',
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: doc.currency,
                            unit_amount: doc.price_minor,
                            product_data: { name: doc.title },
                        },
                    },
                ],
                client_reference_id: user.id,
                ...(user.email ? { customer_email: user.email } : {} ),
                metadata,
                payment_intent_data: { metadata },
                expires_at: Math.floor(Date.now() / 1000 ) + SESSION_TTL_SECONDS,
                success_url: `${env.WEB_ORIGIN}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${env.WEB_ORIGIN}/?checkout=cancelled`,
            },
            { idempotencyKey: `checkout-session:${purchase.id}` },
        )
    } catch (err) {
        await supabaseAdmin.from('purchases').update({ status: 'expired' }).eq('id', purchase.id);
        throw err;
    }

    const { error: linkErr } = await supabaseAdmin
        .from('purchases')
        .update({ stripe_checkout_session_id: session.id })
        .eq('id', purchase.id)

    if (linkErr) {
        req.log.error({ err: linkErr, purchaseId: purchase.id }, 'Failed to link checkout session');
    }

    res.status(201).json({ url: session.url, purchaseId: purchase.id });
});