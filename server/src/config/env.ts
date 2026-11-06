import 'dotenv/config';
import process from 'node:process';
import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    WEB_ORIGIN: z.string().url(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SECRET_KEY: z.string().min(1),
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_test_/, 'Only Stripe TEST keys are allowed'),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    ZOHO_ACCOUNTS_URL: z.string().url(),
    ZOHO_API_DOMAIN: z.string().url(),
    ZOHO_CLIENT_ID: z.string().min(1),
    ZOHO_CLIENT_SECRET: z.string().min(1),
    ZOHO_REFRESH_TOKEN: z.string().min(1),
    ADMIN_API_KEY: z.string().min(32, 'Use atleast 32 characters'),
    CRM_WORKER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    CRM_WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('Invalid enviroment configuration');
    for (const issue of parsed.error.issues) {
        console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    }

    process.exit(1);
}

export const env = parsed.data;
