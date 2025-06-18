/**
 * Controller for the Job Scheduler feature that executes jobs in sequence
 * based on their RunOrder in the PriorityJobTypes table. Includes resilient
 * handling of network issues and automatic recovery after power outages.
 */
import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { DatabaseService } from "../services/databaseService";
import { JobManager } from "../jobs/jobManager";

// Define types for database query results
interface JobType {
  JobTypeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string | null;
  linkedField: string | null;
  RunOrder: number;
}

interface CountResult {
  totalCount: number;
}

interface SchedulerState {
  SchedulerJobId: string;
  CurrentJobId: number | null;
  CurrentJobIndex: number | null;
  Status: "running" | "paused" | "completed" | "failed";
  LastUpdated: Date;
}

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

/**
 * Initialize and potentially recover job scheduler state
 * This should be called during application startup
 */
export async function initializeJobScheduler(): Promise<void> {
  try {
    console.log("Initializing job scheduler with recovery capability");

    // Check if there was a previously running scheduler session
    const schedulerState = await DatabaseService.executeQuery<SchedulerState>(
      `SELECT TOP 1 SchedulerJobId, CurrentJobId, CurrentJobIndex, Status, LastUpdated
       FROM PrioritySchedulerState
       ORDER BY LastUpdated DESC`
    );

    if (schedulerState?.length > 0) {
      const state = schedulerState[0];

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
 */
async function updateSchedulerState(
  status: "running" | "paused" | "completed" | "failed"
): Promise<void> {
  if (!schedulerJobId) return;

  try {
    // Get current job info
    const currentJobId = activeJob?.jobTypeId || null;
    const currentJobIndex = jobQueue.findIndex(
      (job) => job.jobTypeId === currentJobId
    );

    await DatabaseService.executeQuery(
      `INSERT INTO PrioritySchedulerState 
         (SchedulerJobId, CurrentJobId, CurrentJobIndex, Status, LastUpdated)
       VALUES (@SchedulerJobId, @CurrentJobId, @CurrentJobIndex, @Status, GETDATE())`,
      {
        SchedulerJobId: schedulerJobId,
        CurrentJobId: currentJobId,
        CurrentJobIndex: currentJobIndex !== -1 ? currentJobIndex : null,
        Status: status,
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

    res.status(500).json({
      success: false,
      message: "Failed to start job scheduler",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Internal method to start the job scheduler
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

  // Update state in database
  await updateSchedulerState("running");

  // Start processing
  void processNextJob();
}

/**
 * Process the next job in the queue
 */
async function processNextJob(): Promise<void> {
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
    // Update scheduler state before starting job
    await updateSchedulerState("running");

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

    // Get total record count for the job
    const countResult = await DatabaseService.executeQuery<CountResult>(
      `SELECT COUNT(*) as totalCount FROM ${jobDetails.DBTableName}`
    );

    const totalCount = countResult[0].totalCount;

    // Create job manager instance
    const jobManager = new JobManager();

    // Determine processing type based on linkedField
    const processingType = jobDetails.linkedField
      ? "grid-parent-child"
      : "queue";

    // Create job history record
    await DatabaseService.executeQuery(
      `INSERT INTO PriorityJobsHistory 
         (JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, 
          SuccessCount, FailureCount, Status, ProcessingType, IsParentChildJob)
       VALUES 
         (@JobId, @JobName, @TableName, @ScreenName, GETDATE(), @TotalRecords,
          0, 0, 'Running', @ProcessingType, 0)`,
      {
        JobId: jobId,
        JobName: nextJob.jobTypeName,
        TableName: jobDetails.DBTableName,
        ScreenName: jobDetails.ScreenName,
        TotalRecords: totalCount,
        ProcessingType: processingType,
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

  // Update state in database before proceeding
  if (jobQueue.length > 0) {
    await updateSchedulerState("running");
  } else {
    await updateSchedulerState("completed");
  }

  // Process the next job with a small delay
  setTimeout(() => void processNextJob(), 1000);
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
  });
}

/**
 * Stop the job scheduler
 */
export function stopJobScheduler(req: Request, res: Response): Response {
  isSchedulerRunning = false;

  // Update state in database
  void updateSchedulerState("paused");

  return res.status(200).json({
    success: true,
    message:
      "Job scheduler stopped successfully. Currently running job will complete before stopping.",
  });
}
