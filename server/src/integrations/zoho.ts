import { tr } from "zod/locales";
import { env } from "../config/env.js";

const ZOHO_API_VERSION = 'v7';
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_SKEW_MS = 5 * 60 * 1000; //Refresh 5 mins before expiry

const DEAL_FIELDS = {
    stage: 'Stage',
    closingDate: 'Closing_Date',
    stripePaymentId: 'Stripe_Payment_ID',
} as const;
const PAID_STAGE = 'Closed Won';

export class ZohoError extends Error {
    constructor(
        message: string,
        public readonly retriable: boolean,
        public readonly status?: number,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'ZohoError';
    }
}

type TokenResponse = { access_token?: string, expires_in?: number, error?: string };
type ZohoRecordResult = { code?: string; status?: string; message?: string };
type ZohoResponse = { code?: string; message?: string; data?: ZohoRecordResult[] };

// cached token
let cachedToken: { value: string, expiresAt: number } | null = null;
let inflightRefresh: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: env.ZOHO_CLIENT_ID,
        client_secret: env.ZOHO_CLIENT_SECRET,
        refresh_token: env.ZOHO_REFRESH_TOKEN,
    });

    let res: Response;
    try {
        res = await fetch(`${env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        throw new ZohoError(`Token refresh network error: ${(err as Error).message}`, true);
    }

    const json = (await res.json().catch(() => ({}))) as TokenResponse;

    if (!res.ok || json.error || !json.access_token) {
        throw new ZohoError(`Token refresh failed: ${json.error ?? `HTTP ${res.status}`}`, true, res.status, json.error);
    }

    cachedToken = {
        value: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
}

async function getAccessToken(): Promise<String> {
    if (cachedToken && cachedToken.expiresAt - REFRESH_SKEW_MS > Date.now()) {
        return cachedToken.value;
    }

    inflightRefresh ??= refreshAccessToken().finally(() => {
        inflightRefresh = null;
    });
    return inflightRefresh;
}

// request with retry
async function zohoRequest(path: string, init: RequestInit, isRetry = false ): Promise<ZohoResponse> {
    const token = await getAccessToken();

    let res: Response;
    try {
        res = await fetch(`${env.ZOHO_API_DOMAIN}/crm/${ZOHO_API_VERSION}${path}`, {
            ...init,
            headers: {
                ...init.headers,
                Authorization: `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (err) {
        throw new ZohoError(`Zoho network error: ${(err as Error).message}`, true);
    }

    if (res.status === 401 && !isRetry) {
        cachedToken = null;
        return zohoRequest(path, init, true);
    }

    const json = ((await res.json().catch(() => null)) ?? {}) as ZohoResponse;
    if (!res.ok) {
        const code = json.code ?? json.data?.[0]?.code;
        const retriable = res.status === 429 || res.status >= 500;
        throw new ZohoError(`Zoho HTTP ${res.status}: ${code ?? 'unknown'}`, retriable, res.status, code);
    }
    return json;
}

// mark deal paid
export async function markDealPaid(input: {
    zohoDealId: string;
    stripePaymentId: string;
    paidAt: Date;
}): Promise<void> {
    const json = await zohoRequest(`/Deals/${encodeURIComponent(input.zohoDealId)}`, {
        method: 'PUT',
        body: JSON.stringify({
            data: [
                {
                    [DEAL_FIELDS.stage]: PAID_STAGE,
                    [DEAL_FIELDS.closingDate]: input.paidAt.toISOString().slice(0, 10),
                    [DEAL_FIELDS.stripePaymentId]: input.stripePaymentId,
                },
            ],
        }),
    });

    // Zoho reports per-record results. A record-level error (deleted Deal,
    // invalid field) won't fix itself, so it's not retriable.
    const record = json.data?.[0];
    if (record?.status !== 'success') {
        throw new ZohoError(
            `Zoho rejected update: ${record?.code ?? 'unknown'} ${record?.message ?? ''}`.trim(),
            false,
            undefined,
            record?.code
        );
    }
}

