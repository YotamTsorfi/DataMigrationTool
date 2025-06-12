/**
 * Controller for the Job Scheduler feature that executes jobs in sequence
 * based on their RunOrder in the PriorityJobTypes table.
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
}

interface CountResult {
  totalCount: number;
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
 * Start the job scheduler and execute jobs in sequence
 */
export async function startJobScheduler(
  req: Request,
  res: Response
): Promise<Response> {
  try {
    // Don't start if already running
    if (isSchedulerRunning) {
      return res.status(409).json({
        success: false,
        message: "Job scheduler is already running",
      });
    }

    // Generate scheduler ID
    schedulerJobId = uuidv4();
    isSchedulerRunning = true;

    // Get all jobs sorted by RunOrder
    const result = await DatabaseService.executeQuery<JobType>(`
      SELECT JobTypeId, JobTypeName, DBTableName, ScreenName, 
             priority_id, linkedField
      FROM PriorityJobTypes
      WHERE RunOrder > 0
      ORDER BY RunOrder ASC
    `);

    // Reset the queue
    jobQueue.length = 0;

    // Add jobs to queue
    for (const job of result) {
      jobQueue.push({
        jobTypeId: job.JobTypeId,
        jobTypeName: job.JobTypeName,
        status: "pending",
      });
    }

    // Start processing the queue asynchronously
    void processNextJob();

    // Return immediate response
    return res.status(200).json({
      success: true,
      schedulerJobId,
      jobQueue,
      message: "Job scheduler started successfully",
    });
  } catch (error) {
    console.error("Error starting job scheduler:", error);
    isSchedulerRunning = false;
    schedulerJobId = null;

    return res.status(500).json({
      success: false,
      message: "Failed to start job scheduler",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Process the next job in the queue
 */
async function processNextJob(): Promise<void> {
  if (jobQueue.length === 0 || !isSchedulerRunning) {
    // No more jobs or scheduler was stopped
    isSchedulerRunning = false;
    activeJob = null;
    return;
  }

  const nextJob = jobQueue[0];
  nextJob.status = "active";

  try {
    // Get job details
    const jobResult = await DatabaseService.executeQuery<JobType>(
      `
      SELECT JobTypeId, JobTypeName, DBTableName, ScreenName, 
             priority_id, linkedField
      FROM PriorityJobTypes
      WHERE JobTypeId = @JobTypeId
    `,
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
    const countResult = await DatabaseService.executeQuery<CountResult>(`
      SELECT COUNT(*) as totalCount
      FROM ${jobDetails.DBTableName}
    `);

    const totalCount = countResult[0].totalCount;

    // Create job manager instance
    const jobManager = new JobManager();

    // Determine processing type based on linkedField
    const processingType = jobDetails.linkedField
      ? "grid-parent-child"
      : "queue";

    // Create job history record
    await DatabaseService.executeQuery(
      `
  INSERT INTO PriorityJobsHistory (
    JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, 
    SuccessCount, FailureCount, Status, ProcessingType, IsParentChildJob
  )
  VALUES (
    @JobId, @JobName, @TableName, @ScreenName, GETDATE(), @TotalRecords,
    0, 0, 'Running', @ProcessingType, 0
  )
`,
      {
        JobId: jobId,
        JobName: nextJob.jobTypeName,
        TableName: jobDetails.DBTableName,
        ScreenName: jobDetails.ScreenName,
        TotalRecords: totalCount,
        ProcessingType: processingType,
      }
    );

    // Create job request object
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
    };

    // Execute job
    await jobManager.startJob(jobId, jobRequest);

    // Job completed successfully
    nextJob.status = "completed";

    console.log(`Job ${nextJob.jobTypeName} completed successfully`);
  } catch (error) {
    console.error(`Error executing job ${nextJob.jobTypeName}:`, error);
    nextJob.status = "failed";
  }

  // Remove the processed job from the queue
  jobQueue.shift();

  // Clear active job
  activeJob = null;

  // Process the next job
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

  return res.status(200).json({
    success: true,
    message:
      "Job scheduler stopped successfully. Currently running job will complete before stopping.",
  });
}
