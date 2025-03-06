import express, { Request, Response, Router } from "express";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";
import { poolPromise } from "../config/db";
import { runJobWithInput, getJobTypes } from "../controllers/jobController";

const router: Router = express.Router();

router.use(priorityAuthMiddleware);

router.post("/run-job", runJobWithInput);
router.get("/job-types", getJobTypes);

router.get("/results", async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const batchResults = await pool.request().query(`
            SELECT * FROM PriorityBatchProcessing ORDER BY StartTime
        `);
    res.status(200).json({
      success: true,
      batchResults: batchResults.recordset,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/errors", async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const errorLogs = await pool.request().query(`
            SELECT * FROM PriorityErrorLogs
        `);
    res.status(200).json({
      success: true,
      errorLogs: errorLogs.recordset,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
