import type { ErrorRequestHandler, RequestHandler } from "express";

export class AppError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export const notFound: RequestHandler = (_req, _res, next) => {
    next(new AppError(404, 'not_found', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof AppError) {
        req.log.warn({ code: err.code }, err.message);
        res.status(err.status).json({ error: { code: err.code, message: err.message }});
        return;
    }

    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};

