import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const server = createApp().listen(env.PORT, () => {
    logger.info(`Server listening on PORT: ${env.PORT}`);
});

function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));