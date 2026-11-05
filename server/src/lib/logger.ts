import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
    level: env.LOG_LEVEL,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers["stripe-signature"]',
            'req.headers["x-admin-key"]',
            'req.headers.cookie',
        ],
        censor: '[redacted]'
    },
});

