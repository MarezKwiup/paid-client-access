import type { RequestHandler } from "express";
import { supabaseAdmin } from "../lib/clients.js";
import { AppError } from "../lib/errors.js";

/**
 * Verifies the Supabase access token sent as `Authorization: Bearer <token>`.
 */

export const requireAuth: RequestHandler = async (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
        throw new AppError(401, 'unauthenticated', 'Missing bearer token');
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
        throw new AppError(401, 'unauthenticated', 'Invalid or expired token');
    }

    req.user = { id: data.user.id, email: data.user.email };
    next();
};