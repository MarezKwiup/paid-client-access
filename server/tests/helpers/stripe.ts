import Stripe from 'stripe';

const stripe = new Stripe('sk_test_dummy');

export function stripeEvent(type: string, object: object, id = `evt_${Math.random().toString(36).slice(2)}`) {
    return {
        id,
        object: 'event',
        type,
        data: { object },
        created: Math.floor(Date.now() / 1000),
        livemode: false
    };
}

export function signed(event: object, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
    const payload = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    return { payload, header };
}