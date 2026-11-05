import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './lib/errors.js';
import { apiRouter } from './routes/index.js';

export function createApp() {
    const app = express();

    app.use(helmet());
    app.use(pinoHttp({ logger }));
    app.use(cors({ origin: env.WEB_ORIGIN }));

    // Stripe webhook mounts here because signature verification requires raw request body.

    app.use(express.json({ limit: '100kb' }));

    app.get('/health', (_req, res) => {
        res.json({ ok: true });
    });

    app.use('/api', apiRouter);

    app.use(notFound);
    app.use(errorHandler);
    
    return app;
}