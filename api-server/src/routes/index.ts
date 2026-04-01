import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import messagesRouter from "./messages";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/messages", messagesRouter);

export default router;
