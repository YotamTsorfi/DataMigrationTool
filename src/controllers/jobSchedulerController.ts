/**
 * Controller for the Job Scheduler feature that executes jobs in sequence
 * based on their RunOrder in the PriorityJobTypes table. Includes resilient
 * handling of network issues and automatic recovery after power outages.
 */
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { DatabaseService } from "../services/database/databaseService";
import { JobManager } from "../jobs/manager/jobManager";
import { JobCancellationService } from "../utils/jobCancellationService";
import { configService } from "../config/configService";
import { JobType } from "../types/jobTypes";
import { CountResult, SchedulerState } from "../types/jobTypes";

// Job queue and state management
let isSchedulerRunning = false;
const jobQueue: Array<{
  jobTypeId: number;
  jobTypeName: string;
  status: "pending" | "active" | "completed" | "failed";
}> = [];

// Currently active job
let activeJob: {
  jobId: string;
  jobTypeId: number;
  jobTypeName: string;
} | null = null;

// Scheduler job ID
let schedulerJobId: string | null = null;
let selectedCaseId: string | null = null;

/**
 * Initialize and potentially recover job scheduler state
 * This should be called during application startup
 */
export async function initializeJobScheduler(): Promise<void> {
  try {
    console.log("Initializing job scheduler with recovery capability");

    // Check if there was a previously running scheduler session
    const schedulerState = await DatabaseService.executeQuery<SchedulerState>(
      `SELECT TOP 1 SchedulerJobId, CurrentJobId, CurrentJobIndex, Status, LastUpdated, case_id as CaseId
       FROM PrioritySchedulerState
       ORDER BY LastUpdated DESC`
    );

    if (schedulerState?.length > 0) {
      const state = schedulerState[0];

      // Restore case ID if available
      if (state.CaseId) {
        selectedCaseId = state.CaseId;
        console.log(`Restored case ID: ${selectedCaseId}`);
      }

      // If state is less than 24 hours old and was running or paused
      const lastUpdated = new Date(state.LastUpdated);
      const now = new Date();
      const hoursSinceUpdate =
        (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

      if (
        hoursSinceUpdate < 24 &&
        (state.Status === "running" || state.Status === "paused")
      ) {
        console.log(
          `Found previously running scheduler from ${hoursSinceUpdate.toFixed(2)} hours ago. Attempting recovery...`
        );

        // Load the job queue
        await loadJobQueue();

        // Find where to resume from
        if (state.CurrentJobId !== null) {
          const resumeIndex = jobQueue.findIndex(
            (job) => job.jobTypeId === state.CurrentJobId
          );

          if (resumeIndex !== -1) {
            // Adjust the queue to resume from the interrupted job
            jobQueue.splice(0, resumeIndex);
            console.log(`Will resume from job ${jobQueue[0].jobTypeName}`);

            // Set the scheduler ID to the previous one for continuity
            schedulerJobId = state.SchedulerJobId;

            // If the previous state was running, restart the scheduler
            if (state.Status === "running") {
              console.log(
                "Auto-restarting scheduler after system interruption"
              );
              setTimeout(() => {
                startJobSchedulerInternal().catch((error) => {
                  console.error("Error auto-restarting scheduler:", error);
                });
              }, 5000); // Start after a short delay to allow system initialization
            } else {
              console.log("Restored paused scheduler state. Ready to resume.");
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error initializing job scheduler:", error);
  }
}

/**
 * Load the job queue from the database
 */
async function loadJobQueue(): Promise<void> {
  try {
    // Clear the existing queue
    jobQueue.length = 0;

    // Get all jobs sorted by RunOrder
    const jobResult = await DatabaseService.executeQuery<JobType>(
      `SELECT JobTypeId, JobTypeName, DBTableName, ScreenName, 
              priority_id, linkedField, RunOrder
       FROM PriorityJobTypes
       WHERE RunOrder > 0
       ORDER BY RunOrder ASC`
    );

    // Add jobs to the queue
    for (const job of jobResult) {
      jobQueue.push({
        jobTypeId: job.JobTypeId,
        jobTypeName: job.JobTypeName,
        status: "pending",
      });
    }

    console.log(`Loaded ${jobQueue.length} jobs into the scheduler queue`);
  } catch (error) {
    console.error("Error loading job queue:", error);
  }
}

/**
 * Updates the scheduler state in the database for recovery purposes
 * Optimized to avoid duplicate entries and provide a clearer state history
 */
async function updateSchedulerState(
  status: "running" | "paused" | "completed" | "failed"
): Promise<void> {
  if (!schedulerJobId) return;

  try {
    // Get current job info
    const currentJobId = activeJob?.jobTypeId || null;
    const currentJobName = activeJob?.jobTypeName || null;
    const currentJobIndex = jobQueue.findIndex(
      (job) => job.jobTypeId === currentJobId
    );

    // For "running" status with no active job, find the next job
    let jobToRecord = currentJobId;
    let jobNameToRecord = currentJobName;
    let jobIndexToRecord = currentJobIndex;

    if (status === "running" && !currentJobId && jobQueue.length > 0) {
      jobToRecord = jobQueue[0].jobTypeId;
      jobNameToRecord = jobQueue[0].jobTypeName;
      jobIndexToRecord = 0;
    }

    // First, check if there's a recent record with the same status we can skip
    const recentState = await DatabaseService.executeQuery<{
      Id: number;
      Status: string;
    }>(
      `SELECT TOP 1 Id, Status 
       FROM PrioritySchedulerState 
       WHERE SchedulerJobId = @schedulerId 
       ORDER BY LastUpdated DESC`,
      { schedulerId: schedulerJobId }
    );

    // Skip if we would be adding the same status again (prevents duplicates)
    if (recentState?.length > 0 && recentState[0].Status === status) {
      console.log(`Skipping redundant '${status}' state update`);
      return;
    }

    // Log what we're recording for debugging
    console.log(
      `Recording scheduler state: ${status} for job: ${jobNameToRecord || "none"} with case ID: ${selectedCaseId || "none"}`
    );

    await DatabaseService.executeQuery(
      `INSERT INTO PrioritySchedulerState 
       (SchedulerJobId, CurrentJobId, CurrentJobIndex, CurrentJobName, Status, LastUpdated, case_id)
       VALUES (@SchedulerJobId, @CurrentJobId, @CurrentJobIndex, @CurrentJobName, @Status, GETDATE(), @CaseId)`,
      {
        SchedulerJobId: schedulerJobId,
        CurrentJobId: jobToRecord,
        CurrentJobIndex: jobIndexToRecord !== -1 ? jobIndexToRecord : null,
        CurrentJobName: jobNameToRecord,
        Status: status,
        CaseId: selectedCaseId, // Include the selected case ID
      }
    );
  } catch (error) {
    console.error("Error updating scheduler state:", error);
  }
}

/**
 * Start the job scheduler and execute jobs in sequence
 */
export async function startJobScheduler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Don't start if already running
    if (isSchedulerRunning) {
      res.status(409).json({
        success: false,
        message: "Job scheduler is already running",
      });
      return;
    }

    // Extract case ID from request body
    selectedCaseId = req.body.caseId || null;
    console.log(
      `Starting job scheduler with case ID: ${selectedCaseId || "none"}`
    );

    await startJobSchedulerInternal();

    res.status(200).json({
      success: true,
      schedulerJobId,
      jobQueue,
      message: "Job scheduler started successfully",
    });
  } catch (error) {
    console.error("Error starting job scheduler:", error);
    isSchedulerRunning = false;
    schedulerJobId = null;
    selectedCaseId = null;

    res.status(500).json({
      success: false,
      message: "Failed to start job scheduler",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Internal method to start the job scheduler
 * Initializes the job scheduler with a unique ID if needed, loads the job queue,
 * and begins processing jobs in sequence with optimized state updates.
 */
async function startJobSchedulerInternal(): Promise<void> {
  // Generate scheduler ID if not already set from recovery
  if (!schedulerJobId) {
    schedulerJobId = uuidv4();
  }

  // Set running flag
  isSchedulerRunning = true;

  // Load jobs if queue is empty
  if (jobQueue.length === 0) {
    await loadJobQueue();
  }

  // Update state in database just once here
  await updateSchedulerState("running");

  // Start processing without updating state again
  void processNextJobWithoutStateUpdate();
}

/**
 * Process the next job in the queue without redundant state updates
 * Optimized version of processNextJob that minimizes database writes
 */
async function processNextJobWithoutStateUpdate(): Promise<void> {
  if (jobQueue.length === 0 || !isSchedulerRunning) {
    // No more jobs or scheduler was stopped
    isSchedulerRunning = false;
    activeJob = null;
    await updateSchedulerState("completed");
    return;
  }

  const nextJob = jobQueue[0];
  nextJob.status = "active";

  try {
    // Get job details
    const jobResult = await DatabaseService.executeQuery<JobType>(
      `SELECT JobTypeId, JobTypeName, DBTableName, ScreenName, 
              priority_id, linkedField
       FROM PriorityJobTypes
       WHERE JobTypeId = @JobTypeId`,
      {
        JobTypeId: nextJob.jobTypeId,
      }
    );

    if (jobResult.length === 0) {
      throw new Error(`Job type ${nextJob.jobTypeId} not found`);
    }

    const jobDetails = jobResult[0];

    // Generate job ID
    const jobId = uuidv4();

    // Set as active job
    activeJob = {
      jobId,
      jobTypeId: nextJob.jobTypeId,
      jobTypeName: nextJob.jobTypeName,
    };

    // Update state with the active job info
    await updateSchedulerState("running");

    // Get total record count for the job
    const countResult = await DatabaseService.executeQuery<CountResult>(
      `SELECT COUNT(*) as totalCount FROM ${jobDetails.DBTableName}`
    );

    const totalCount = countResult[0].totalCount;

    // Create job manager instance
    const jobManager = new JobManager();

    const config = await configService.getConfig();
    const company = config.PRIORITY_COMPANY || "";

    // Determine processing type based on linkedField
    const processingType = jobDetails.linkedField
      ? "grid-parent-child"
      : "queue";

    // Create job history record
    await DatabaseService.executeQuery(
      `INSERT INTO PriorityJobsHistory 
     (JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, 
      SuccessCount, FailureCount, Status, ProcessingType, IsParentChildJob, Company, CreatedBy)
   VALUES 
     (@JobId, @JobName, @TableName, @ScreenName, GETDATE(), @TotalRecords,
      0, 0, 'Running', @ProcessingType, 0, @Company, @CreatedBy)`,
      {
        JobId: jobId,
        JobName: nextJob.jobTypeName,
        TableName: jobDetails.DBTableName,
        ScreenName: jobDetails.ScreenName,
        TotalRecords: totalCount,
        ProcessingType: processingType,
        Company: company,
        CreatedBy: "Yotam",
      }
    );

    // Create job request object with retry capabilities
    const jobRequest = {
      recordCount: totalCount,
      startRow: 1,
      tableName: jobDetails.DBTableName,
      priorityScreenName: jobDetails.ScreenName,
      jobType: jobDetails.JobTypeName,
      processingType,
      priorityIdField: jobDetails.priority_id || "",
      priorityLinkedField: jobDetails.linkedField || undefined,
      priorityJobTypeId: jobDetails.JobTypeId,
      processAllRecords: true,
      retryOnConnectionFailure: true, // Enable network resilience
      maxRetries: 0, // Set to 0 for infinite retries
      caseId: selectedCaseId ?? undefined, // Include the selected case ID
    };

    // Execute job with retries for network issues
    await jobManager.startJob(jobId, jobRequest);

    // Job completed successfully
    nextJob.status = "completed";
    console.log(`Job ${nextJob.jobTypeName} completed successfully`);
  } catch (error) {
    console.error(`Error executing job ${nextJob.jobTypeName}:`, error);
    nextJob.status = "failed";
    await updateSchedulerState("failed");
  }

  // Remove the processed job from the queue
  jobQueue.shift();

  // Clear active job
  activeJob = null;

  // Update state in database before proceeding to next job
  // Skip this update if we've been stopped or there are no more jobs
  if (jobQueue.length > 0 && isSchedulerRunning) {
    await updateSchedulerState("running");
  } else if (jobQueue.length === 0) {
    await updateSchedulerState("completed");
  }

  // Process the next job with a small delay to prevent CPU hogging
  if (isSchedulerRunning) {
    setTimeout(() => void processNextJobWithoutStateUpdate(), 1000);
  }
}

/**
 * Get the current status of the job scheduler
 */
export function getJobSchedulerStatus(req: Request, res: Response): Response {
  return res.status(200).json({
    isRunning: isSchedulerRunning,
    schedulerJobId,
    activeJob,
    jobQueue,
    caseId: selectedCaseId, // Include the selected case ID in the response
  });
}

/**
 * Stop the job scheduler
 */
export function stopJobScheduler(req: Request, res: Response): Response {
  // First check if scheduler is running
  if (!isSchedulerRunning) {
    return res.status(400).json({
      success: false,
      message: "Job scheduler is not running",
    });
  }

  isSchedulerRunning = false;

  // Get current job info for state update
  const currentJobId = activeJob?.jobTypeId || null;

  // Update state in database
  void updateSchedulerState("paused");

  // Cancel the currently running job if there is one
  if (activeJob) {
    // Request cancellation of the active job
    JobCancellationService.requestCancellation(activeJob.jobId);
    console.log(
      `Requested cancellation of active job ${activeJob.jobId} for pausing`
    );

    // Make sure the job status in the queue is updated
    const activeJobIndex = jobQueue.findIndex(
      (job) => job.jobTypeId === currentJobId
    );
    if (activeJobIndex !== -1) {
      jobQueue[activeJobIndex].status = "pending"; // Reset to pending so it can be rerun
      console.log(
        `Reset job ${jobQueue[activeJobIndex].jobTypeName} status to pending for later resumption`
      );
    }
  }

  return res.status(200).json({
    success: true,
    message:
      "Job scheduler paused successfully. Currently running job will be cancelled.",
  });
}

/**
 * Resume a paused job scheduler
 */
export async function resumeJobScheduler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (isSchedulerRunning) {
      res.status(409).json({
        success: false,
        message: "Job scheduler is already running",
      });
      return;
    }

    if (!schedulerJobId) {
      res.status(400).json({
        success: false,
        message: "No paused job scheduler found to resume",
      });
      return;
    }

    // Extract case ID from request body or use the existing one
    if (req.body.caseId) {
      selectedCaseId = req.body.caseId;
      console.log(`Resuming job scheduler with new case ID: ${selectedCaseId}`);
    }

    // Get the last state to find out which job was paused
    const schedulerState = await DatabaseService.executeQuery<SchedulerState>(
      `SELECT TOP 1 SchedulerJobId, CurrentJobId, CurrentJobIndex, Status, LastUpdated
       FROM PrioritySchedulerState
       WHERE SchedulerJobId = @schedulerId AND Status = 'paused'
       ORDER BY LastUpdated DESC`,
      { schedulerId: schedulerJobId }
    );

    // Before resuming, reload the entire job queue
    await loadJobQueue();

    // If we found a valid paused state, restore the job queue to that point
    if (schedulerState?.length > 0 && schedulerState[0].CurrentJobId !== null) {
      const pausedJobId = schedulerState[0].CurrentJobId;
      console.log(
        `Found paused job ID ${pausedJobId}, will resume from this job`
      );

      // Find the index of the paused job in the full queue
      const resumeIndex = jobQueue.findIndex(
        (job) => job.jobTypeId === pausedJobId
      );

      if (resumeIndex !== -1) {
        // Remove all jobs before the paused job
        if (resumeIndex > 0) {
          console.log(
            `Adjusting queue to resume from job ${jobQueue[resumeIndex].jobTypeName} (removing ${resumeIndex} completed jobs)`
          );
          jobQueue.splice(0, resumeIndex);
        }
      }
    }

    // Clear any cancellation requests that might be lingering
    if (activeJob?.jobId) {
      JobCancellationService.clearCancellationRequest(activeJob.jobId);
    }

    // Start processing from the adjusted queue
    await startJobSchedulerInternal();

    console.log(
      `Scheduler resumed successfully with ${jobQueue.length} jobs remaining`
    );
    console.log(
      `Next job to run: ${jobQueue.length > 0 ? jobQueue[0].jobTypeName : "None"}`
    );

    res.status(200).json({
      success: true,
      schedulerJobId,
      jobQueue,
      message: "Job scheduler resumed successfully",
      caseId: selectedCaseId, // Include caseId in response
    });
  } catch (error) {
    console.error("Error resuming job scheduler:", error);
    isSchedulerRunning = false;

    res.status(500).json({
      success: false,
      message: "Failed to resume job scheduler",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
