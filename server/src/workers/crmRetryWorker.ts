import { logger } from "../lib/logger.js";
import { processDueSyncs } from "../services/crmSync.js";

export function startCrmRetryWorker(intervalMs: number): () => void {
    const log = logger.child({ component: 'crm-retry-worker'});
    let running = false;
    let stopped = false;
    
    const tick = async () => {
        if (running || stopped) return;
        running = true;
        try {
            const r = await processDueSyncs(log);
            if (r.synced + r.retry_scheduled + r.failed > 0) log.info(r, 'CRM retry tick');
        } catch (err) {
            log.error({ err }, 'CRM retry tick failed');
        } finally {
            running = false;
        }
    };

    const timer = setInterval(tick, intervalMs);
    timer.unref(); // don't keep the process alive just for this
    void tick(); // run at boot once
    log.info({ intervalMs }, 'CRM retry worker started');

    return () => {
        stopped = true;
        clearInterval(timer);
    };
}