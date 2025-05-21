import { DatabaseService } from "../services/databaseService";
import { configService } from "../config/configService"; //DB
import { v4 as uuidv4 } from "uuid";
import { processBatches } from "../jobs/job";
import ProgressTracker from "../utils/progressTracker";
import { processWithQueues } from "../jobs/queueJob";
import { processParentChildBatches } from "../jobs/jobParentAndChilds";
import { ErrorBufferService } from "../utils/errorBufferService";

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
  logErrors?: boolean;
}

interface ChildJob {
  ChildJobeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string;
  HasSiblings: boolean;
}

interface JobResult {
  successCount?: number;
  failureCount?: number;
  success?: boolean;
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
    INSERT INTO PriorityJobsHistory (JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, Status, ProcessingType, IsParentChildJob)
    VALUES (@JobId, @JobName, @TableName, @ScreenName, @StartTime, @TotalRecords, @Status, @ProcessingType, 0)
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
  /**
   * Starts the job processing by updating the job status and executing the appropriate processing method.
   * @param jobId - The unique identifier for the job.
   * @param jobRequest - The request object containing job parameters.
   * @returns A promise that resolves with the job results.
   */
  async startJob(jobId: string, jobRequest: JobRequest): Promise<any> {
    const jobStartTime = Date.now();
    let results;
    const systemConfig = await configService.getConfig();

    // Use the explicit value from jobRequest if provided, otherwise use the system config
    const logErrors =
      jobRequest.logErrors !== undefined
        ? jobRequest.logErrors
        : !(
            systemConfig.LOG_ERROR === 0 ||
            systemConfig.LOG_ERROR === "0" ||
            systemConfig.LOG_ERROR === false
          );

    // Configure ErrorBufferService based on the logging flag
    ErrorBufferService.getInstance().setLoggingEnabled(logErrors);

    console.log(`Job ${jobId} starting with request:`, {
      recordCount: jobRequest.recordCount,
      tableName: jobRequest.tableName,
      processingType: jobRequest.processingType || "default not set",
      logErrors: logErrors,
    });

    console.log(`Job ${jobId} starting at: ${adjustTimeZone(new Date())}`);

    // עדכון סטטוס העבודה ל-"מתבצעת"
    await this.updateJobStatus(jobId, "Running");

    // קביעת סוג העיבוד (batch או queue)
    const processingType =
      jobRequest.processingType || (await this.getDefaultProcessingType());

    // עדכון סוג העיבוד במסד הנתונים
    await DatabaseService.executeQuery(
      `UPDATE PriorityJobsHistory SET ProcessingType = @ProcessingType WHERE JobId = @JobId`,
      {
        ProcessingType: processingType,
        JobId: jobId,
      }
    );

    try {
      // בדיקה האם מדובר בעבודה עם קשרי הורה-ילד
      if (jobRequest.priorityLinkedField) {
        // חילוץ עבודות ילד ממסד הנתונים
        const childJobs = (await DatabaseService.executeQuery(
          `SELECT ChildJobeId, JobTypeName, DBTableName, ScreenName, priority_id, HasSiblings 
         FROM PriorityChildJob 
         WHERE refParentJobId = @JobTypeId`,
          {
            JobTypeId: jobRequest.priorityJobTypeId,
          }
        )) as ChildJob[];

        const childJobCount = childJobs.length;

        // אם יש עבודות ילד ומדובר בעיבוד מסוג batch, הפעלת מעבד הורה-ילד
        if (childJobCount > 0 && processingType === "batch") {
          console.log(`Job ${jobId} executing parent-child batch processing`);

          // סימון הג'וב כאב-בן כדי למנוע יצירת ג'ובים נפרדים לטבלאות הילדים
          await DatabaseService.executeQuery(
            `UPDATE PriorityJobsHistory SET IsParentChildJob = 1, ChildTables = @ChildTables WHERE JobId = @JobId`,
            {
              JobId: jobId,
              ChildTables: childJobs.map((job) => job.DBTableName).join(","),
            }
          );

          console.log(
            `Job ${jobId} marked as parent-child job with ${childJobCount} child tables: ${childJobs.map((job) => job.DBTableName).join(", ")}`
          );

          // Configure error buffer for larger batch size for parent-child processing
          ErrorBufferService.getInstance().configure({
            flushSize: 1000, // Larger batch size for parent-child operations
            minFlushSize: 200, // Higher minimum to prevent small flushes
            flushInterval: 60000, // Longer interval for parent-child operations
          });

          results = await processParentChildBatches(
            jobRequest.recordCount,
            jobRequest.startRow,
            jobRequest.tableName,
            jobRequest.priorityScreenName,
            jobRequest.jobType,
            jobId,
            jobRequest.priorityIdField,
            jobRequest.priorityLinkedField,
            childJobs,
            logErrors
          );

          // Reset error buffer configuration to default after parent-child processing
          ErrorBufferService.getInstance().configure({
            flushSize: 500,
            minFlushSize: 100,
            flushInterval: 30000,
          });
        } else {
          // אם אין עבודות ילד או לא מדובר בעיבוד מסוג batch, ביצוע עיבוד רגיל
          console.log(
            `Job ${jobId} has parent-child relationship but using standard processing (${processingType})`
          );
          results = await this.executeStandardProcessing(
            jobId,
            jobRequest,
            processingType,
            logErrors
          );
        }
      } else {
        // אין קשרי הורה-ילד, ביצוע עיבוד רגיל
        console.log(
          `Job ${jobId} using standard processing (${processingType})`
        );
        results = await this.executeStandardProcessing(
          jobId,
          jobRequest,
          processingType,
          logErrors
        );
      }

      // Ensure all buffered errors are flushed before completing the job
      await ErrorBufferService.getInstance().flushAll();

      // חישוב סטטיסטיקות הצלחה וכישלון
      const totalSuccess = results.reduce((acc: number, result: JobResult) => {
        // Use only explicit successCount and avoid fallback to result.success
        return (
          acc +
          (typeof result.successCount === "number" ? result.successCount : 0)
        );
      }, 0);

      const totalFailures = results.reduce((acc: number, result: JobResult) => {
        // Use only explicit failureCount and avoid fallback to !result.success
        return (
          acc +
          (typeof result.failureCount === "number" ? result.failureCount : 0)
        );
      }, 0);

      // סיום המעקב אחר התקדמות העבודה
      ProgressTracker.completeJob(jobId, totalSuccess, totalFailures);

      // עדכון סטטוס העבודה ל-"הושלמה"
      await this.updateJobStatus(
        jobId,
        "Completed",
        totalSuccess,
        totalFailures,
        totalFailures > 0 ? "Some records failed" : undefined
      );

      // הדפסת סטטיסטיקות ביצועים
      const jobEndTime = Date.now();
      const jobDurationSec = ((jobEndTime - jobStartTime) / 1000).toFixed(2);
      console.log(
        `Job ${jobId} completed in ${jobDurationSec} seconds. Results: Success: ${totalSuccess}, Failures: ${totalFailures}`
      );

      return results;
    } catch (error) {
      // טיפול בשגיאות
      console.error(`Job ${jobId} failed with error:`, error);

      // Ensure errors are flushed even on job failure
      try {
        await ErrorBufferService.getInstance().flushAll();
      } catch (flushError) {
        console.error("Error flushing error buffer:", flushError);
      }

      // עדכון סטטוס העבודה ל-"נכשלה"
      await this.updateJobStatus(
        jobId,
        "Failed",
        0,
        jobRequest.recordCount,
        error instanceof Error ? error.message : "Unknown error"
      );

      throw error;
    }
  }

  // פונקציית עזר לביצוע עיבוד רגיל (הוצאתי לפונקציה נפרדת למען הסדר)
  private async executeStandardProcessing(
    jobId: string,
    jobRequest: JobRequest,
    processingType: string,
    logErrors: boolean = false
  ): Promise<any> {
    console.log(
      `Job ${jobId} starting ${processingType} processing with error logging ${logErrors ? "enabled" : "disabled"}`
    );

    // אתחול מעקב התקדמות
    ProgressTracker.initJob(jobId, jobRequest.recordCount);

    const batchStartTime = Date.now();
    console.log(
      `Job ${jobId} starting processing at: ${new Date().toISOString()}`
    );

    let results;

    if (processingType === "queue") {
      // עיבוד עם תורים
      results = await processWithQueues(
        jobRequest.recordCount,
        jobRequest.startRow,
        jobRequest.tableName,
        jobRequest.priorityScreenName,
        jobRequest.jobType,
        jobId,
        jobRequest.priorityIdField,
        logErrors
      );
    } else {
      // עיבוד רגיל במנות (ברירת המחדל)
      results = await processBatches(
        jobRequest.recordCount,
        jobRequest.startRow,
        jobRequest.tableName,
        jobRequest.priorityScreenName,
        jobRequest.jobType,
        jobId,
        jobRequest.priorityIdField,
        logErrors
      );
    }

    const batchEndTime = Date.now();
    const batchDurationSec = ((batchEndTime - batchStartTime) / 1000).toFixed(
      2
    );
    console.log(
      `Job ${jobId} completed processing in ${batchDurationSec} seconds at: ${adjustTimeZone(new Date())}`
    );

    return results;
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
