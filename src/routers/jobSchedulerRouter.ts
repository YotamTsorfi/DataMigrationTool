/**
 * Router for job scheduler endpoints that allows users to manage sequential job processing
 * Provides endpoints to start, stop and check status of the job scheduler
 */
import express, { Request, Response, Router } from "express";
import {
  startJobScheduler,
  getJobSchedulerStatus,
  stopJobScheduler,
  resumeJobScheduler,
} from "../controllers/jobSchedulerController";

// Create router instance
const router: Router = express.Router();

// Start the job scheduler
router.post("/start", async (req: Request, res: Response): Promise<void> => {
  try {
    await startJobScheduler(req, res);
    // Express will handle the response since we're passing res to the controller
  } catch (error) {
    console.error("Error in start job scheduler route:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get current status of the job scheduler
router.get("/status", (req: Request, res: Response): void => {
  try {
    getJobSchedulerStatus(req, res);
    // Express will handle the response since we're passing res to the controller
  } catch (error) {
    console.error("Error in get job scheduler status route:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Stop the job scheduler
router.post("/stop", (req: Request, res: Response): void => {
  try {
    stopJobScheduler(req, res);
    // Express will handle the response since we're passing res to the controller
  } catch (error) {
    console.error("Error in stop job scheduler route:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Resume the job scheduler - add this new endpoint
router.post("/resume", (req: Request, res: Response): void => {
  try {
    resumeJobScheduler(req, res);
  } catch (error) {
    console.error("Error in resume job scheduler route:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resume job scheduler",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
