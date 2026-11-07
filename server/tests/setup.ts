// Runs before every test file
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://localhost:5173',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.test',
  ZOHO_API_DOMAIN: 'https://www.zohoapis.test',
  ZOHO_CLIENT_ID: 'test-client-id',
  ZOHO_CLIENT_SECRET: 'test-client-secret',
  ZOHO_REFRESH_TOKEN: 'test-refresh-token',
  ADMIN_API_KEY: 'a'.repeat(64),
  CRM_WORKER_ENABLED: 'false',
});