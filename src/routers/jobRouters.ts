import express, { Request, Response, Router } from "express";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";
import { poolPromise } from "../config/db";
import { runJobWithInput, getJobTypes } from "../controllers/jobController";
import { JobManager } from "../jobs/jobManager";
import ProgressTracker from "../utils/progressTracker";

const router: Router = express.Router();

router.use(priorityAuthMiddleware);

router.post("/run-job", runJobWithInput);
//-----------------------------------
router.get("/job-types", getJobTypes);
//-----------------------------------
router.post("/run-multiple-jobs", async (req: Request, res: Response) => {
  const jobRequests = req.body; // Array of job requests

  try {
    const jobManager = new JobManager();
    const results = await jobManager.startMultipleJobs(jobRequests);

    res.status(200).json(results);
  } catch (error) {
    console.error("Error running multiple jobs:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
//-----------------------------------
router.get("/results", async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const batchResults = await pool.request().query(`
            SELECT * FROM PriorityBatchProcessing ORDER BY StartTime DESC
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
//-----------------------------------
router.get("/errors", async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const errorLogs = await pool.request().query(`
            SELECT * FROM PriorityErrorLogs ORDER BY TimeStamp DESC
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
//-----------------------------------
router.get(
  "/jobs-history",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const pool = await poolPromise;
      if (!pool) {
        throw new Error("Database connection pool is null");
      }
      const jobsHistory = await pool
        .request()
        .query(`SELECT * FROM PriorityJobsHistory order by StartTime desc`);
      res.status(200).json({
        success: true,
        jobsHistory: jobsHistory.recordset,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

//-----------------------------------
router.get(
  "/progress/:jobId",
  async (req: Request, res: Response): Promise<void> => {
    const jobId = req.params.jobId;

    const progress = ProgressTracker.getProgress(jobId);

    if (!progress) {
      res.status(404).json({
        success: false,
        message: "Job not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      progress,
    });
  }
);
//-----------------------------------
router.get(
  "/active-jobs",
  async (req: Request, res: Response): Promise<void> => {
    const activeJobs = ProgressTracker.getAllActiveJobs();

    res.status(200).json({
      success: true,
      activeJobs,
    });
  }
);
export default router;
