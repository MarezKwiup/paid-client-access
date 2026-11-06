import { Router } from "express";
import { z } from 'zod';
import { supabaseAdmin } from "../lib/clients.js";
import { AppError } from "../lib/errors.js";
import { requireAdmin } from "../middleware/admin.js";
import { requeueFailedSync, syncPurchaseToZoho } from "../services/crmSync.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// List syncs that need attention
adminRouter.get('/crm-syncs', async (_req, res) => {
    const { data, error } = await supabaseAdmin
        .from('crm_syncs')
        .select('purchase_id, status, attempts, last_error, next_attempt_at, updated_at')
        .in('status', ['pending', 'failed'])
        .order('updated_at', { ascending: false} )
        .limit(50);
    if (error) throw error;
    res.json({ syncs: data });
});

// Retry one purchase's Zoho update
adminRouter.post('/crm-syncs/:purchaseId/retry', async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.params.purchaseId);
    if (!parsed.success) throw new AppError(400, 'invalid_request', 'purchaseId must be UUID');
    const purchaseId = parsed.data;

    const { data: row, error } = await supabaseAdmin
        .from('crm_syncs')
        .select('status, next_attempt_at')
        .eq('purchase_id', purchaseId)
        .maybeSingle();
    if (error) throw error;
    if (!row) throw new AppError(404, 'sync_not_found', 'No CRM sync for this purchase');

    if (row.status === 'synced') {
        res.json({ outcome: 'already_synced' });
        return;
    }

    if (row.status === 'failed') {
        await requeueFailedSync(purchaseId);
    } else if (new Date(row.next_attempt_at) > new Date()) {
        res.status(202).json({ outcome: 'already_queued', nextAttemptAt: row.next_attempt_at });
        return;
    }

    const outcome = await syncPurchaseToZoho(purchaseId, req.log);
    res.json({ outcome });
});