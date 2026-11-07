import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './helpers/fakeSupabase.js';

vi.mock('../src/lib/clients.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/clients.js')>();
    const { fakeSupabase } = await import ('./helpers/fakeSupabase.js');
    return {
        ...actual,
        supabaseAdmin: fakeSupabase.client as unknown as typeof actual.supabaseAdmin
    }
});

import { createApp } from '../src/app.js';

const app = createApp();
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEAL_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DOC_ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
    fakeSupabase.reset();
    fakeSupabase.getUser.mockImplementation(async (token: string) => {
        if (token === 'token-a') return {
            data: {
                user: {
                    id: CLIENT_A,
                    email: 'client-a@test.com'
                }
            },
            error: null
        }

        if (token === 'token-b') return {
            data: {
                user: {
                    id: CLIENT_B,
                    email:'client-b@test.com'
                }
            },
            error: null
        }

        return {
            data: {
                user: null
            },
            error: {
                message: 'invalid token'
            }
        }
    });
});

describe('authentication', () => {
    it('rejects checkout without a token', async () => {
        const res = await request(app).post('/api/checkout').send({ dealId: DEAL_A });
        expect(res.status).toBe(401);
    });

    it('rejects checkout with an invalid token', async () => {
        const res = await request(app).post('/api/checkout').set('Authorization', 'Bearer forged').send({ dealId: DEAL_A });
        expect(res.status).toBe(401);
    });

    it('validates the request body', async () => {
        const res = await request(app).post('/api/checkout')
            .set('Authorization', 'Bearer token-a')
            .send({ dealId: 'x' });
        expect(res.status).toBe(400);
    });
});

describe('client isolation', () => {
    it('returns 404 when client B tries to buy client A deal', async () => {
        fakeSupabase.setTable('deals', null);

        const res = await request(app).post('/api/checkout')
            .set('Authorization', 'Bearer token-b')
            .send({ dealId: DEAL_A });
        
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('deal_not_found');
        expect(fakeSupabase.filteredBy('deals', 'client_id', CLIENT_B)).toBe(true);
    });

    it('refuses a second purchase of a document the client already owns', async () => {
        fakeSupabase.setTable('deals', {
            id: DEAL_A,
            document: {
                id: DOC_ID,
                title: 'Sample Document',
                price_minor: 49900,
                currency: 'inr'
            }
        });
        fakeSupabase.setTable('entitlements', { id: 'ent-1' });

        const res = await request(app).post('/api/checkout')
            .set('Authorization', 'Bearer token-a')
            .send({ dealId: DEAL_A });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('already_owned');
    });

    it('denies a download without an active entitlement', async () => {
        fakeSupabase.setTable('documents', {
            id: DOC_ID,
            title: 'Sample Document',
            storage_path: 'sample-document.pdf'
        });
        fakeSupabase.setTable('entitlements', null);

        const res = await request(app).get(`/api/documents/${DOC_ID}/download`).set('Authorization', 'Bearer token-b');

        expect(res.status).toBe(403);
        expect(fakeSupabase.filteredBy('entitlements', 'client_id', CLIENT_B)).toBe(true);
    });
});

describe('admin endpoints', () => {
  it('rejects a missing admin key', async () => {
    expect((await request(app).get('/api/admin/crm-syncs')).status).toBe(401);
  });

  it('rejects a wrong admin key', async () => {
    const res = await request(app).get('/api/admin/crm-syncs').set('x-admin-key', 'b'.repeat(64));
    expect(res.status).toBe(401);
  });

  it('accepts the correct admin key', async () => {
    fakeSupabase.setTable('crm_syncs', []);
    const res = await request(app).get('/api/admin/crm-syncs').set('x-admin-key', 'a'.repeat(64));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ syncs: [] });
  });
});