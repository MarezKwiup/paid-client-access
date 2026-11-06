import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { processDueSyncs, requeueFailedSync, syncPurchaseToZoho } from '../services/crmSync.js';

const log = logger.child({ component: 'retry-crm-cli' });

async function main() {
    const arg = process.argv[2];

    if (arg) {
        const id = z.string().uuid().parse(arg);
        await requeueFailedSync(id);
        const outcome = await syncPurchaseToZoho(id, log);
        log.info({ purchaseId: id, outcome }, 'Done');
        return outcome === 'synced' || outcome === 'skipped' ? 0 : 1;
    }

    const results = await processDueSyncs(log, 100);
    log.info(results, 'Done');
    return results.failed + results.retry_scheduled > 0 ? 1 : 0;
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        log.error({ err }, 'retry-crm crashed');
        process.exit(1);
    });