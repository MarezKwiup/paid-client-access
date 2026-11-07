import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const DEAL_ID = '1471028000000481563';
const input = {
    zohoDealId: DEAL_ID,
    stripePaymentId: 'pi_test_123',
    paidAt: new Date('2026-11-07T10:00:00Z')
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json'
        }
    });

const tokenOk = (token = 'access-1') =>
    json({ access_token: token, expires_in: 3600 });
const updateOk = () =>
    json({
        data: [
            { code: 'SUCCESS', status: 'success' }
        ]
    });

let fetchMock: ReturnType<typeof vi.fn>;
const isTokenCall = (url: unknown) => String(url).includes('/oauth/v2/token');
const tokenCalls = () => fetchMock.mock.calls.filter(([url]) => isTokenCall(url)).length;
const apiCalls = () => fetchMock.mock.calls.filter(([url]) => !isTokenCall(url));

/** Route fetch by URL: token endpoint vs. a queue of API responses. */
function routeFetch(apiResponses: Array<() => Response>, tokenResponses: Array<() => Response> = [() => tokenOk()]) {
    fetchMock.mockImplementation(async (url: unknown) => {
        const queue = isTokenCall(url) ? tokenResponses : apiResponses;
        const next = queue.length > 1 ? queue.shift()! : queue[0]!;
        return next();
    });
}

// Fresh module per test: the access-token cache lives at module level.
const loadZoho = () => import('../src/integrations/zoho.js');

beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('Zoho client', () => {
    it('refreshes once, caches the token, and sends the update', async () => {
        routeFetch([updateOk]);
        const { markDealPaid } = await loadZoho();

        await markDealPaid(input);
        await markDealPaid(input);

        expect(tokenCalls()).toBe(1);
        const [url, init] = apiCalls()[0]!;
        expect(String(url)).toBe(`https://www.zohoapis.test/crm/v7/Deals/${DEAL_ID}`);
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: 'Zoho-oauthtoken access-1'
        });
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({
            data: [{ Stage: 'Closed Won', Closing_Date: '2026-11-07', Stripe_Payment_ID: 'pi_test_123' }],
        });
    });

    it('shares one in-flight refresh between concurrent calls', async () => {
        routeFetch([updateOk]);
        const { markDealPaid } = await loadZoho();

        await Promise.all([markDealPaid(input), markDealPaid(input), markDealPaid(input)]);

        expect(tokenCalls()).toBe(1);
        expect(apiCalls()).toHaveLength(3);
    });

    it('treats HTTP 200 with an error field from token endpoint as failure', async () => {
        routeFetch([updateOk], [() => json({ error: 'invalid_code' })]);
        const { markDealPaid } = await loadZoho();

        await expect(markDealPaid(input)).rejects.toMatchObject({
            name: 'ZohoError',
            retriable: true,
            code: 'invalid_code'
        });
        expect(apiCalls()).toHaveLength(0);
    })

    it('refreshes and retries once when Zoho rejects the access token', async () => {
        routeFetch(
            [() => json({ code: 'INVALID_TOKEN' }, 401), updateOk],
            [() => tokenOk('access-1'), () => tokenOk('access-2')],
        );
        const { markDealPaid } = await loadZoho();
        
        await markDealPaid(input);

        expect(tokenCalls()).toBe(2);
        expect((apiCalls()[1]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Zoho-oauthtoken access-2' });
    });

    it('classifies rate limit as retriable', async () => {
        routeFetch([ () => json({ code: 'TOO_MANY_REQUESTS '}, 429)]);
        const { markDealPaid } = await loadZoho();
        await expect(markDealPaid(input)).rejects.toMatchObject({
            retriable: true,
            status: 429
        });
    })

    it('classifies network failures as retriable', async () => {
        fetchMock.mockImplementation(async (url: unknown) => {
            if (isTokenCall(url)) return tokenOk();
            throw new TypeError('fetch failed');
        });
        const { markDealPaid } = await loadZoho();
        await expect(markDealPaid(input)).rejects.toMatchObject({ retriable: true });
    });

    it('moves the Deal out of Closed Won on refund', async () => {
        routeFetch([updateOk]);
        const { markDealRefunded } = await loadZoho();

        await markDealRefunded({ zohoDealId: DEAL_ID });

        const body = JSON.parse((apiCalls()[0]![1] as RequestInit).body as string);
        expect(body).toEqual({
            data: [
                { Stage: 'Closed Lost'}
            ]
        });
    });
});

describe('backoff', () => {
    it('grows exponetially with jitter and is capped at one hour', async () => {
        const { backoffMs } = await import('../src/services/crmSync.js');
        for (let attempt = 1; attempt <= 5; attempt++) {
            const base = 30_000 * 2 ** (attempt - 1);
            const value = backoffMs(attempt);
            expect(value).toBeGreaterThanOrEqual(base * 0.8);
            expect(value).toBeLessThanOrEqual(base * 1.2);
        }
        expect(backoffMs(30)).toBeLessThanOrEqual(60 * 60 * 1000 * 1.2);
    })
})
