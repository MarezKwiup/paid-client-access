import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fakeSupabase.js";
import { signed, stripeEvent } from "./helpers/stripe.js";

vi.mock("../src/lib/clients.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/clients.js")>();
  const { fakeSupabase } = await import("./helpers/fakeSupabase.js");
  return {
    ...actual,
    supabaseAdmin:
      fakeSupabase.client as unknown as typeof actual.supabaseAdmin,
  };
});

vi.mock("../src/services/crmSync.js", () => ({
  syncPurchaseToZoho: vi.fn(async () => "synced"),
  requeueFailedSync: vi.fn(),
  processDueSyncs: vi.fn(),
}));

import { createApp } from "../src/app.js";
import { stripe } from "../src/lib/clients.js";
import { syncPurchaseToZoho } from "../src/services/crmSync.js";

const app = createApp();
const sync = vi.mocked(syncPurchaseToZoho);
const PURCHASE_ID = "11111111-1111-4111-8111-111111111111";

function paidSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_123",
    object: "checkout.session",
    payment_status: "paid",
    payment_intent: "pi_test_123",
    amount_total: 49900,
    currency: "inr",
    metadata: { purchase_id: PURCHASE_ID },
    ...overrides,
  };
}

function refundedCharge(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch_test_123",
    object: "charge",
    payment_intent: "pi_test_123",
    amount: 49900,
    amount_refunded: 49900,
    refunded: true,
    ...overrides,
  };
}

function send(event: object, secret?: string) {
  const { payload, header } = signed(event, secret);
  return request(app)
    .post("/api/webhook")
    .set("stripe-signature", header)
    .set("content-type", "application/json")
    .send(payload);
}

function fulfilReturns(
  crmSyncStatus: "pending" | "synced" | null,
  newlyPaid = true,
) {
  fakeSupabase.rpc.mockResolvedValue({
    data: {
      purchase_id: PURCHASE_ID,
      newly_paid: newlyPaid,
      status: "paid",
      zoho_deal_id: "1471028000000481563",
      crm_sync_status: crmSyncStatus,
    },
    error: null,
  });
}

beforeEach(() => {
  fakeSupabase.reset();
  sync.mockReset();
  sync.mockResolvedValue("synced");
});

describe("signature verification", () => {
  it("rejects a request with a Stripe-Signature header", async () => {
    const res = await request(app)
      .post("/api/webhook")
      .set("content-type", "application/json")
      .send("{}");
    expect(res.status).toBe(400);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a payload signed with wrong secret", async () => {
    const res = await send(
      stripeEvent("checkout.session.completed", paidSession()),
      "whsec_attacker",
    );
    expect(res.status).toBe(400);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed", () => {
  it("fulfils with values from Stripe and our own purchase id, then syncs Zoho", async () => {
    fulfilReturns('pending');
    const event = stripeEvent('checkout.session.completed', paidSession());

    const res = await send(event);

    expect(res.status).toBe(200);
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('fulfil_purchase', {
        p_purchase_id: PURCHASE_ID,
        p_session_id: 'cs_test_123',
        p_payment_intent_id: 'pi_test_123',
        p_amount_minor: 49900,
        p_currency: 'inr',
        p_event_id: event.id,
        p_event_type: 'checkout.session.completed',
    });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith(PURCHASE_ID, expect.anything()));
  });

  it('skips an event that was already processed', async () => {
    fakeSupabase.setTable('stripe_events', { processed_at: '2026-11-07T00:00:00Z'});

    const res = await send(stripeEvent('checkout.session.completed', paidSession()));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('does not call Zoho again when purchase was already paid', async () => {
    fulfilReturns('synced', false);
    const res = await send(stripeEvent('checkout.session.completed', paidSession()));
    expect(res.status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
  });

  it('waits from async payment methods instead of granting access while unpaid', async () => {
    const res = await send(stripeEvent('checkout.session.completed', paidSession({ payment_status: 'unpaid' })));
    expect(res.status).toBe(200);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
    expect(fakeSupabase.wrote('stripe_events', 'upsert')).toBe(true);
  });

  it('ignores sessions without a valid purchase_id', async () => {
    const res = await send(stripeEvent('checkout.session.completed', paidSession({ metadata: { purchase_id: 'not-a-uuid'} })));
    expect(res.status).toBe(200);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('acks an unwatchable payment without granting access', async () => {
    fakeSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
            message: `amount_mismatch: purchase ${PURCHASE_ID}`,
        }
    });
    const res = await send(stripeEvent('checkout.session.completed', paidSession({ amount_total: 100 })));
    expect(res.status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
  });

  it('returns 500 on a transient database error so Stripe redelivers', async () => {
    fakeSupabase.rpc.mockResolvedValue({
        data: null,
        error: {
            message: 'connection refused',
        }
    });
    const res = await send(stripeEvent('checkout.session.completed', paidSession()));
    expect(res.status).toBe(500);
  });

  it('still acks Stripe when Zoho sync crashes', async () => {
    fulfilReturns('pending');
    sync.mockRejectedValueOnce(new Error('Zoho exploded'));
    const res = await send(stripeEvent('checkout.session.completed', paidSession()));
    expect(res.status).toBe(200);
  });
});

describe('charge.refunded', () => {
    it('refunds the purchase matched by payment intent', async () => {
        fakeSupabase.setTable('purchases', { id: PURCHASE_ID });
        fakeSupabase.rpc.mockResolvedValue({
            data: {
                purchase_id: PURCHASE_ID,
                newly_refunded: true,
                access_revoked: true,
                crm_sync_status: 'pending'
            },
            error: null
        });
        const event = stripeEvent('charge.refunded', refundedCharge());

        const res = await send(event);

        expect(res.status).toBe(200);
        expect(fakeSupabase.filteredBy('purchases', 'stripe_payment_intent_id', 'pi_test_123')).toBe(true);
        expect(fakeSupabase.rpc).toHaveBeenCalledWith('refund_purchase', {
            p_purchase_id: PURCHASE_ID,
            p_payment_intent_id: 'pi_test_123',
            p_event_id: event.id,
            p_event_type: 'charge.refunded',
        });
        await vi.waitFor(() => expect(sync).toHaveBeenCalledWith(PURCHASE_ID, expect.anything()));
    });

    it('keeps access on a partial refund', async () => {
        const res = await send(stripeEvent('charge.refunded', refundedCharge({ refunded: false, amount_refunded: 10000 })));
        expect(res.status).toBe(200);
        expect(fakeSupabase.rpc).not.toHaveBeenCalled();
    });

    it('falls back to PaymentIntent metadata when refund arrives before checkout completion', async () => {
        const retrieve = vi
            .spyOn(stripe.paymentIntents, 'retrieve')
            .mockResolvedValue({
                metadata: {
                    purchase_id: PURCHASE_ID
                }
            } as never);
        fakeSupabase.rpc.mockResolvedValue({
            data: {
                purchase_id: PURCHASE_ID,
                newly_refunded: true,
                access_revoked: false,
                crm_sync_status: null
            },
            error: null
        });

        const res = await send(stripeEvent('charge.refunded', refundedCharge()));

        expect(res.status).toBe(200);
        expect(retrieve).toHaveBeenCalledWith('pi_test_123');
        expect(fakeSupabase.rpc).toHaveBeenCalledWith('refund_purchase', expect.objectContaining({ p_purchase_id: PURCHASE_ID }));
        expect(sync).not.toHaveBeenCalled();
        retrieve.mockRestore();
    });
});
