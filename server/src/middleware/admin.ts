import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const expected = sha256(env.ADMIN_API_KEY);

/** Constant-time comparison; hashing first makes both buffers the same length. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
    const provided = req.header('x-admin-key');
    if (!provided || !timingSafeEqual(sha256(provided), expected)) {
        throw new AppError(401, 'unauthorized', 'Invalid admin key');
    }
    next();
}