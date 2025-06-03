import express, { Request, Response, Router } from "express";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";
import { getJobTypes } from "../controllers/jobController";
import { JobManager } from "../jobs/jobManager";
import ProgressTracker from "../utils/progressTracker";
import { formatErrorMessage } from "../utils/errorHandler";
import { JobCancellationService } from "../utils/jobCancellationService";

const router: Router = express.Router();
router.use(priorityAuthMiddleware);
//-----------------------------------
// For BatchDashboard.tsx & BathProcessor.tsx
router.get("/job-types", getJobTypes);
//-----------------------------------
// For jobProgressTracker.tsx
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
// For jobProgressTracker.tsx
// /job/active-jobs
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
//-----------------------------------
// /job/start-with-type/:type
// Add a route to specify processing type
router.post(
  "/start-with-type/:type",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { type } = req.params;
      const jobRequest = req.body;

      // Validate processing type
      if (type !== "batch" && type !== "queue") {
        res.status(400).json({
          success: false,
          error: "Processing type must be 'batch' or 'queue'",
        });
        return;
      }

      // Add processing type to job request
      jobRequest.processingType = type;

      const jobManager = new JobManager();
      const jobId = await jobManager.createJob(jobRequest);

      // Start job asynchronously
      jobManager
        .startJob(jobId, jobRequest)
        .catch((error) => console.error(`Error running job ${jobId}:`, error));

      res.status(202).json({
        success: true,
        jobId,
        message: `Job started with ${type} processing, check progress via status endpoint`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: formatErrorMessage(error),
      });
    }
  }
);

// Endpoint to cancel a running job
router.post("/cancel/:jobId", async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const jobManager = new JobManager();

    // Request cancellation
    JobCancellationService.requestCancellation(jobId);

    // Update status in database to show cancellation is requested
    await jobManager.updateJobStatus(
      jobId,
      "Cancelling",
      undefined,
      undefined,
      "Cancellation requested by user"
    );

    res.json({
      success: true,
      message: `Cancellation requested for job ${jobId}`,
    });
  } catch (error) {
    console.error("Error cancelling job:", error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;

//----------------------Old code----------------------
//router.post("/run-job", runJobWithInput);
//-----------------------------------
// router.post("/run-multiple-jobs", async (req: Request, res: Response) => {
//   const jobRequests = req.body; // Array of job requests

//   try {
//     const jobManager = new JobManager();
//     const results = await jobManager.startMultipleJobs(jobRequests);

//     res.status(200).json(results);
//   } catch (error) {
//     console.error("Error running multiple jobs:", error);
//     res.status(500).json({
//       error: error instanceof Error ? error.message : "Unknown error",
//     });
//   }
// });
//-----------------------------------
