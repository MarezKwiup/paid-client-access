import { Router } from "express";
import { checkoutRouter } from "./checkout.js";

export const apiRouter = Router();
apiRouter.use('/checkout', checkoutRouter);
