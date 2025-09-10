import { io } from "../index";
import { JobProgress } from "../types/jobTypes";

/**
 * A service for tracking and reporting job progress
 */
class ProgressTracker {
  private static jobProgress: Map<string, JobProgress> = new Map();

  /**
   * Initialize job progress tracking
   */
  static initJob(jobId: string, totalRecords: number, jobName?: string): void {
    const progress: JobProgress = {
      jobId,
      jobName,
      totalRecords,
      processedRecords: 0,
      successCount: 0,
      failureCount: 0,
      percentage: 0,
      status: "pending",
    };

    this.jobProgress.set(jobId, progress);
    this.emitProgress(jobId);
  }

  /**
   * Update job progress
   *  Note: processedRecords should always be the total number of records processed so far,
   *  including both successful and failed records. This counter should never decrease during processing.
   */
  static updateProgress(
    jobId: string,
    processedRecords: number,
    successCount: number,
    failureCount: number
  ): void {
    const progress = this.jobProgress.get(jobId);
    if (!progress) {
      console.warn(
        `Attempted to update progress for non-existent job: ${jobId}`
      );
      return;
    }

    // Check for regression in processedRecords
    if (processedRecords < progress.processedRecords) {
      // console.warn(
      //   `Progress regression detected for job ${jobId}: processedRecords decreased from ${progress.processedRecords} to ${processedRecords}`
      // );
      // Ensure processedRecords never goes backwards
      processedRecords = Math.max(processedRecords, progress.processedRecords);
    }

    // Ensure consistency between processedRecords and success+failure counts
    // if (processedRecords !== successCount + failureCount) {
    //   console.warn(
    //     `Progress inconsistency detected for job ${jobId}: processedRecords (${processedRecords}) != successCount (${successCount}) + failureCount (${failureCount})`
    //   );
    // }

    progress.processedRecords = processedRecords;
    progress.successCount = successCount;
    progress.failureCount = failureCount;
    progress.percentage = Math.round(
      (processedRecords / progress.totalRecords) * 100
    );
    progress.status = "processing";

    this.emitProgress(jobId);
  }

  /**
   * Mark job as complete
   */
  static completeJob(
    jobId: string,
    successCount: number,
    failureCount: number
  ): void {
    const progress = this.jobProgress.get(jobId);
    if (!progress) return;

    progress.processedRecords = progress.totalRecords;
    progress.successCount = successCount;
    progress.failureCount = failureCount;
    progress.percentage = 100;
    // progress.status = failureCount > 0 ? "failed" : "completed";
    progress.status = "completed";

    this.emitProgress(jobId);

    // Keep the completed job data for 10 minutes then remove it
    setTimeout(() => {
      this.jobProgress.delete(jobId);
    }, 600000);
  }

  /**
   * Emit progress update through socket.io
   */
  private static emitProgress(jobId: string): void {
    const progress = this.jobProgress.get(jobId);
    if (!progress) return;

    // Include jobName in the emitted progress data
    const progressData = {
      jobId: progress.jobId,
      jobName: progress.jobName,
      totalRecords: progress.totalRecords,
      processedRecords: progress.processedRecords,
      successCount: progress.successCount,
      failureCount: progress.failureCount,
      percentage: Math.round(
        (progress.processedRecords / progress.totalRecords) * 100
      ),
      status: progress.status,
    };

    io.emit("job:progress", progressData);
  }

  /**
   * Get progress for a specific job
   */
  static getProgress(jobId: string): JobProgress | undefined {
    return this.jobProgress.get(jobId);
  }

  /**
   * Get all active jobs
   */
  static getAllActiveJobs(): JobProgress[] {
    return Array.from(this.jobProgress.values()).filter(
      (job) => job.status === "pending" || job.status === "processing"
    );
  }
}

export default ProgressTracker;
