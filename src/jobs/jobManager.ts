import { poolPromise } from "../config/db";
import { v4 as uuidv4 } from "uuid";
import sql from "mssql";
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
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Failed to connect to the database");
    }

    await pool
      .request()
      .input("JobID", sql.UniqueIdentifier, jobId)
      .input("JobName", sql.NVarChar, jobRequest.jobType)
      .input("TableName", sql.NVarChar, jobRequest.tableName)
      .input("ScreenName", sql.NVarChar, jobRequest.priorityScreenName)
      .input("StartTime", sql.DateTime, adjustTimeZone(new Date()))
      .input("TotalRecords", sql.Int, jobRequest.recordCount)
      .input("Status", sql.NVarChar, "Queued").query(`
        INSERT INTO PriorityJobsHistory (JobID, JobName, TableName, ScreenName, StartTime, TotalRecords, Status)
        VALUES (@JobID, @JobName, @TableName, @ScreenName, @StartTime, @TotalRecords, @Status)
      `);

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
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Failed to connect to the database");
    }

    await pool
      .request()
      .input("JobID", sql.UniqueIdentifier, jobId)
      .input("Status", sql.NVarChar, status)
      .input("SuccessCount", sql.Int, totalSuccess ?? 0)
      .input("FailureCount", sql.Int, totalFailures ?? 0)
      .input("ErrorMessage", sql.NVarChar, errorMessage ?? null)
      .input("EndTime", sql.DateTime, adjustTimeZone(new Date())).query(`
        UPDATE PriorityJobsHistory
        SET Status = @Status, SuccessCount = @SuccessCount, FailureCount = @FailureCount, ErrorMessage = @ErrorMessage, EndTime = @EndTime
        WHERE JobID = @JobID
      `);
  }

  //   ----------------------------
  async startJob(jobId: string, jobRequest: JobRequest): Promise<any> {
    await this.updateJobStatus(jobId, "Running");

    // Initialize progress tracking
    ProgressTracker.initJob(jobId, jobRequest.recordCount);

    const results = await processBatches(
      jobRequest.recordCount,
      jobRequest.startRow,
      jobRequest.tableName,
      jobRequest.priorityScreenName,
      jobRequest.jobType,
      jobId
    );

    const totalSuccess = results.reduce(
      (acc, result) => acc + (result.success ? 1 : 0),
      0
    );
    const totalFailures = results.length - totalSuccess;

    // Mark job as complete in progress tracker
    ProgressTracker.completeJob(jobId, totalSuccess, totalFailures);

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
