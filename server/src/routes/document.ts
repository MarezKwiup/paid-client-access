import { Router } from "express";
import { z } from 'zod';
import { supabaseAdmin } from "../lib/clients.js";
import { AppError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { apiRouter } from "./index.js";

const SIGNED_URL_TTL_SECONDS = 60;
export const documentsRouter = Router();

documentsRouter.get('/:documentId/download', requireAuth, async (req, res) => {
    const parsed = z.string().uuid().safeParse(req.params.documentId);
    if (!parsed.success) throw new AppError(400, 'invalid_request', 'documentId must be a UUID');
    const documentId = parsed.data;
    const user = req.user!;

    const { data: doc, error: docErr } = await supabaseAdmin
        .from('documents')
        .select('id, title, storage_path')
        .eq('id', documentId)
        .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) throw new AppError(404, 'document_not_found', 'Document not found');
    
    // Access check
    const { data: ent, error: entErr } = await supabaseAdmin
        .from('entitlements')
        .select('id')
        .eq('client_id', user.id)
        .eq('document_id', doc.id)
        .is('revoked_at', null)
        .maybeSingle();
    if (entErr) throw entErr;
    if (!ent) throw new AppError(403, 'no_access', 'Purchase this document to download it');

    const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS, { download: `${doc.title}.pdf`});
    if (signErr) throw signErr;
    
    req.log.info({ documentId, userId: user.id }, 'Signed download issued');
    res.set('Cache-Control', 'no-store');
    res.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
});
