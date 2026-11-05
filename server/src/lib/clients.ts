import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { env } from '../config/env.js';
import type { Database } from "../types/database.js";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
});

export const supabaseAdmin = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});