import { Router } from "express";
import { checkoutRouter } from "./checkout.js";
import { documentsRouter } from "./document.js";
import { adminRouter } from "./admin.js";

export const apiRouter = Router();
apiRouter.use('/checkout', checkoutRouter);
apiRouter.use('/documents', documentsRouter);
apiRouter.use('/admin', adminRouter);
