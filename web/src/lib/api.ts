import { env } from "./env";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new ApiError(401, 'unauthenticated', 'Please sign in again');

    const res = await fetch(`${env.apiUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        throw new ApiError(
            res.status,
            body?.error?.code ?? 'request_failed',
            body?.error?.message ?? `Request failed (${res.status})`,
        );
    }
    return body as T;
}

export const api = {
    startCheckout: (dealId: string) =>
        request<{url: string; purchaseId: string}>('/api/checkout', {
            method: 'POST',
            body: JSON.stringify({ dealId }),
        }),
    getDownloadUrl: (documentId: string) =>
        request<{url: string; expiresIn: number}>(`/api/documents/${documentId}/download`),
};

export function messageOf(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) return String(err.message);
    return 'Something went wrong';
}