import { DatabaseService } from "../services/databaseService";
import { v4 as uuidv4 } from "uuid";
import { processBatches } from "../jobs/job";
import ProgressTracker from "../utils/progressTracker";
import { processWithQueues } from "../jobs/queueJob";
import { processParentChildBatches } from "../jobs/jobParentAndChilds";

interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
  jobType: string;
  processingType?: string;
  priorityIdField: string;
  priorityLinkedField?: string;
  priorityJobTypeId?: number;
}

interface ChildJob {
  ChildJobeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string;
  HasSiblings: boolean;
}

type JobStatus = "Queued" | "Running" | "Completed" | "Failed";

const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

class JobManager {
  //   ----------------------------
  async createJob(jobRequest: JobRequest): Promise<string> {
    const jobId = uuidv4();

    await DatabaseService.executeQuery(
      `
      INSERT INTO PriorityJobsHistory (JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, Status, ProcessingType)
      VALUES (@JobId, @JobName, @TableName, @ScreenName, @StartTime, @TotalRecords, @Status,  @ProcessingType)
    `,
      {
        JobId: jobId,
        JobName: jobRequest.jobType,
        TableName: jobRequest.tableName,
        ScreenName: jobRequest.priorityScreenName,
        StartTime: adjustTimeZone(new Date()),
        TotalRecords: jobRequest.recordCount,
        Status: "Queued",
        ProcessingType: jobRequest.processingType || "batch", // Default to "batch" if not provided
      }
    );

    return jobId;
  }
  //   ----------------------------
  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    totalSuccess?: number,
    totalFailures?: number,
    errorMessage?: string
  ): Promise<void> {
    await DatabaseService.executeQuery(
      `
      UPDATE PriorityJobsHistory
      SET Status = @Status, SuccessCount = @SuccessCount, FailureCount = @FailureCount, ErrorMessage = @ErrorMessage, EndTime = @EndTime
      WHERE JobId = @JobId
    `,
      {
        JobId: jobId,
        Status: status,
        SuccessCount: totalSuccess ?? 0,
        FailureCount: totalFailures ?? 0,
        ErrorMessage: errorMessage ?? null,
        EndTime: adjustTimeZone(new Date()),
      }
    );
  }

  //   ----------------------------
  async startJob(jobId: string, jobRequest: JobRequest): Promise<any> {
    const jobStartTime = Date.now();
    let results;
    //console.log(`Job ${jobId} starting at: ${new Date().toISOString()}`);

    console.log(`Job ${jobId} starting with request:`, {
      recordCount: jobRequest.recordCount,
      tableName: jobRequest.tableName,
      processingType: jobRequest.processingType || "default not set",
    });

    const formatDateTime = (date: Date): string => {
      const day = date.getDate().toString().padStart(2, "0");
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, "0");
      const minutes = date.getMinutes().toString().padStart(2, "0");
      const seconds = date.getSeconds().toString().padStart(2, "0");
      const milliseconds = date.getMilliseconds().toString().padStart(2, "0");

      return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}:${milliseconds}`;
    };

    console.log(`Job ${jobId} starting at: ${formatDateTime(new Date())}`);

    await this.updateJobStatus(jobId, "Running");

    const processingType =
      jobRequest.processingType || (await this.getDefaultProcessingType());
    console.log(`Job ${jobId} using processing type: ${processingType}`);

    await DatabaseService.executeQuery(
      `UPDATE PriorityJobsHistory SET ProcessingType = @ProcessingType WHERE JobId = @JobId`,
      {
        ProcessingType: processingType,
        JobId: jobId,
      }
    );

    // Check if we need parent-child processing
    let isParentChildProcessing = false;

    // Check if priorityLinkedField from job request has a value
    // If so, send it to the processing function
    if (jobRequest.priorityLinkedField) {
      // console.log(
      //   `Job ${jobId} has priorityLinkedField: ${jobRequest.priorityLinkedField}`
      // );
      // console.log(
      //   `Job ${jobId} has priorityJobTypeId  : ${jobRequest.priorityJobTypeId}`
      // );

      // Get child jobs in a single query
      const childJobs = (await DatabaseService.executeQuery(
        `SELECT ChildJobeId, JobTypeName, DBTableName, ScreenName, priority_id, HasSiblings 
        FROM PriorityChildJob 
        WHERE refParentJobId = @JobTypeId`,
        {
          JobTypeId: jobRequest.priorityJobTypeId,
        }
      )) as ChildJob[];

      // Use the length of the returned array for the count
      const childJobCount = childJobs.length;
      // console.log(`Job ${jobId} has ${childJobCount} child jobs`);

      // If we have child jobs and we're using batch processing, use the parent-child processor
      if (childJobCount > 0 && processingType === "batch") {
        console.log(`Job ${jobId} using parent-child batch processing`);
        isParentChildProcessing = true;

        // Call the parent-child processor with the already retrieved child job details
        results = await processParentChildBatches(
          jobRequest.recordCount,
          jobRequest.startRow,
          jobRequest.tableName,
          jobRequest.priorityScreenName,
          jobRequest.jobType,
          jobId,
          jobRequest.priorityIdField,
          jobRequest.priorityLinkedField,
          childJobs
        );

        // Calculate success and failure for parent-child processing
        const totalSuccess = results.reduce(
          (acc, result) => acc + (result.successCount || 0),
          0
        );
        const totalFailures = results.reduce(
          (acc, result) => acc + (result.failureCount || 0),
          0
        );

        // Update job status for parent-child processing
        await this.updateJobStatus(
          jobId,
          //totalFailures === 0 ? "Completed" : "Failed",
          "Completed", // Always mark as completed for parent-child processing
          totalSuccess,
          totalFailures,
          totalFailures > 0 ? "Some records failed" : undefined
        );

        // Mark job as complete in progress tracker
        ProgressTracker.completeJob(jobId, totalSuccess, totalFailures);
      }

      // Only run standard processing if parent-child processing wasn't used
      if (!isParentChildProcessing) {
        console.log(`Job ${jobId} starting ${processingType} processing`);
        console.log(
          `Job ${jobId} status updated to Running at: ${new Date().toISOString()}`
        );

        // Initialize progress tracking
        ProgressTracker.initJob(jobId, jobRequest.recordCount);

        const batchStartTime = Date.now();

        console.log(
          `Job ${jobId} starting batch processing at: ${new Date().toISOString()}`
        );

        if (processingType === "queue") {
          results = await processWithQueues(
            jobRequest.recordCount,
            jobRequest.startRow,
            jobRequest.tableName,
            jobRequest.priorityScreenName,
            jobRequest.jobType,
            jobId,
            jobRequest.priorityIdField
          );
        } else {
          // Default to batch processing
          results = await processBatches(
            jobRequest.recordCount,
            jobRequest.startRow,
            jobRequest.tableName,
            jobRequest.priorityScreenName,
            jobRequest.jobType,
            jobId,
            jobRequest.priorityIdField
          );
        }

        const batchEndTime = Date.now();
        const batchDurationSec = (
          (batchEndTime - batchStartTime) /
          1000
        ).toFixed(2);
        console.log(
          `Job ${jobId} completed batch processing in ${batchDurationSec} seconds at: ${formatDateTime(new Date())}`
        );

        const totalSuccess = results.reduce(
          (acc, result) =>
            acc + (result.successCount || (result.success ? 1 : 0)),
          0
        );
        const totalFailures = results.reduce(
          (acc, result) =>
            acc + (result.failureCount || (result.success ? 0 : 1)),
          0
        );

        // Mark job as complete in progress tracker
        ProgressTracker.completeJob(jobId, totalSuccess, totalFailures);

        const jobEndTime = Date.now();
        const jobDurationSec = ((jobEndTime - jobStartTime) / 1000).toFixed(2);

        console.log(
          `Job ${jobId} completed in ${jobDurationSec} seconds. Overall results: Success: ${totalSuccess}, Failures: ${totalFailures}`
        );

        await this.updateJobStatus(
          jobId,
          // totalFailures === 0 ? "Completed" : "Failed",
          "Completed", // Always mark as completed for standard processing
          totalSuccess,
          totalFailures,
          totalFailures > 0 ? "Some batches failed" : undefined
        );

        return results;
      }
    }
  }
  //   ----------------------------
  async startMultipleJobs(jobRequests: JobRequest[]): Promise<any[]> {
    const results = [];
    for (const request of jobRequests) {
      const jobId = await this.createJob(request);
      const result = await this.startJob(jobId, request);
      results.push({ jobId, result });
    }
    return results;
  }
  //   ----------------------------
  // Get default processing type from system configuration
  private async getDefaultProcessingType(): Promise<string> {
    try {
      const result = await DatabaseService.executeQuery(
        `SELECT ConfigValue FROM PrioritySystemConfig WHERE ConfigKey = 'PROCESSING_TYPE'`
      );

      return result && result[0]
        ? (result[0] as { ConfigValue: string }).ConfigValue
        : "batch";
    } catch (error) {
      console.error("Error fetching default processing type:", error);
      return "batch"; // Default to batch processing if we can't get the config
    }
  }
}

export { JobManager };
