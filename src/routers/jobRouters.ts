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
// router.get("/results", async (req: Request, res: Response): Promise<void> => {
//   try {
//     const pool = await poolPromise;
//     if (!pool) {
//       throw new Error("Database connection pool is null");
//     }
//     const batchResults = await pool.request().query(`
//             SELECT * FROM PriorityBatchProcessing ORDER BY StartTime DESC
//         `);
//     res.status(200).json({
//       success: true,
//       batchResults: batchResults.recordset,
//     });
//   } catch (error) {
//     // Replace this line
//     // res.status(500).json({
//     //   success: false,
//     //   error: error instanceof Error ? error.message : "Unknown error",
//     // });

//     // With this improved error handling
//     res.status(500).json({
//       success: false,
//       error: formatErrorMessage(error),
//     });

//     // Log the full error details for debugging
//     logAxiosError(error, "Jobs API - Get Results");
//   }
// });
//-----------------------------------
// router.get("/errors", async (req: Request, res: Response): Promise<void> => {
//   try {
//     const pool = await poolPromise;
//     if (!pool) {
//       throw new Error("Database connection pool is null");
//     }
//     const errorLogs = await pool.request().query(`
//             SELECT * FROM PriorityErrorLogs ORDER BY TimeStamp DESC
//         `);
//     res.status(200).json({
//       success: true,
//       errorLogs: errorLogs.recordset,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       error: error instanceof Error ? error.message : "Unknown error",
//     });
//   }
// });
//-----------------------------------
// router.get(
//   "/jobs-history",
//   async (req: Request, res: Response): Promise<void> => {
//     try {
//       const jobsHistory = await DatabaseService.executeQuery(
//         `SELECT * FROM PriorityJobsHistory ORDER BY StartTime DESC`
//       );
//       res.status(200).json({
//         success: true,
//         jobsHistory,
//       });
//     } catch (error) {
//       res.status(500).json({
//         success: false,
//         error: error instanceof Error ? error.message : "Unknown error",
//       });
//     }
//   }
// );
//-----------------------------------

//-----------------------------------
// // Update system configuration
// router.put(
//   "/config/:key",
//   async (req: Request, res: Response): Promise<void> => {
//     try {
//       const { key } = req.params;
//       const { value } = req.body;

//       await DatabaseService.executeQuery(
//         `UPDATE PrioritySystemConfig SET ConfigValue = @Value WHERE ConfigKey = @Key`,
//         {
//           Key: key,
//           Value: value,
//         }
//       );

//       res.status(200).json({
//         success: true,
//         message: `Configuration ${key} updated to ${value}`,
//       });
//     } catch (error) {
//       res.status(500).json({
//         success: false,
//         error: formatErrorMessage(error),
//       });
//     }
//   }
// );

// // update grid configuration
// router.put(
//   "/config/grid",
//   async (req: Request, res: Response): Promise<void> => {
//     try {
//       const { horizontalBatchSize, verticalBatchSize } = req.body;

//       // Validate inputs
//       if (!horizontalBatchSize || !verticalBatchSize) {
//         res.status(400).json({
//           success: false,
//           error: "Both horizontalBatchSize and verticalBatchSize are required",
//         });
//         return;
//       }

//       // Update horizontal batch size
//       await DatabaseService.executeQuery(
//         `UPDATE PrioritySystemConfig SET ConfigValue = @Value WHERE ConfigKey = 'HORIZONTAL_BATCH_SIZE'`,
//         {
//           Value: horizontalBatchSize.toString(),
//         }
//       );

//       // Update vertical batch size
//       await DatabaseService.executeQuery(
//         `UPDATE PrioritySystemConfig SET ConfigValue = @Value WHERE ConfigKey = 'VERTICAL_BATCH_SIZE'`,
//         {
//           Value: verticalBatchSize.toString(),
//         }
//       );

//       res.status(200).json({
//         success: true,
//         message: `Grid configuration updated: Horizontal=${horizontalBatchSize}, Vertical=${verticalBatchSize}`,
//       });
//     } catch (error) {
//       res.status(500).json({
//         success: false,
//         error: formatErrorMessage(error),
//       });
//     }
//   }
// );
