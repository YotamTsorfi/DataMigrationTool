import { DatabaseService } from "../services/databaseService";
import { v4 as uuidv4 } from "uuid";
import { processBatches } from "../jobs/job";
import ProgressTracker from "../utils/progressTracker";

interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
  jobType: string;
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
      INSERT INTO PriorityJobsHistory (JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, Status)
      VALUES (@JobId, @JobName, @TableName, @ScreenName, @StartTime, @TotalRecords, @Status)
    `,
      {
        JobId: jobId,
        JobName: jobRequest.jobType,
        TableName: jobRequest.tableName,
        ScreenName: jobRequest.priorityScreenName,
        StartTime: adjustTimeZone(new Date()),
        TotalRecords: jobRequest.recordCount,
        Status: "Queued",
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
    console.log(`Job ${jobId} starting at: ${new Date().toISOString()}`);

    await this.updateJobStatus(jobId, "Running");

    // console.log(
    //   `Job ${jobId} status updated to Running at: ${new Date().toISOString()}`
    // );

    // Initialize progress tracking
    ProgressTracker.initJob(jobId, jobRequest.recordCount);

    const batchStartTime = Date.now();
    // console.log(
    //   `Job ${jobId} starting batch processing at: ${new Date().toISOString()}`
    // );

    const results = await processBatches(
      jobRequest.recordCount,
      jobRequest.startRow,
      jobRequest.tableName,
      jobRequest.priorityScreenName,
      jobRequest.jobType,
      jobId
    );

    const batchEndTime = Date.now();
    const batchDurationSec = ((batchEndTime - batchStartTime) / 1000).toFixed(
      2
    );
    console.log(
      `Job ${jobId} completed batch processing in ${batchDurationSec} seconds at: ${new Date().toISOString()}`
    );

    const totalSuccess = results.reduce(
      (acc, result) => acc + (result.success ? 1 : 0),
      0
    );
    const totalFailures = results.length - totalSuccess;

    // Mark job as complete in progress tracker
    ProgressTracker.completeJob(jobId, totalSuccess, totalFailures);

    const jobEndTime = Date.now();
    const jobDurationSec = ((jobEndTime - jobStartTime) / 1000).toFixed(2);

    console.log(
      `Job ${jobId} completed in ${jobDurationSec} seconds. Overall results: Success: ${totalSuccess}, Failures: ${totalFailures}`
    );

    await this.updateJobStatus(
      jobId,
      totalFailures === 0 ? "Completed" : "Failed",
      totalSuccess,
      totalFailures,
      totalFailures > 0 ? "Some batches failed" : undefined
    );

    return results;
  }

  async startMultipleJobs(jobRequests: JobRequest[]): Promise<any[]> {
    const jobPromises = jobRequests.map(async (jobRequest) => {
      const jobId = await this.createJob(jobRequest);
      return this.startJob(jobId, jobRequest);
    });

    return Promise.all(jobPromises);
  }
  //   ----------------------------
}

export { JobManager };
