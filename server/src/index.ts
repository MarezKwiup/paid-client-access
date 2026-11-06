import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { startCrmRetryWorker } from "./workers/crmRetryWorker.js";

const server = createApp().listen(env.PORT, () => {
    logger.info(`Server listening on PORT: ${env.PORT}`);
});

const stopWorker = env.CRM_WORKER_ENABLED ? startCrmRetryWorker(env.CRM_WORKER_INTERVAL_MS) : () => {};

function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down');
    stopWorker();
    server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));