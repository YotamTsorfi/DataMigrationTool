import { v4 as uuidv4 } from "uuid";
import { DatabaseService } from "../../services/database/databaseService";
import { configService } from "../../config/configService";
import ProgressTracker from "../../utils/progressTracker";
import { ErrorBufferService } from "../../utils/errorBufferService";
import { JobCancellationService } from "../../utils/jobCancellationService";
import {
  JobStatus,
  JobRequest,
  ChildJob,
  JobResult,
} from "../../types/jobTypes";
import { adjustTimeZone } from "../../utils/dateUtils";
import { processWithQueues } from "../processors/queue/queueJob";
import { processBatches } from "../processors/batch/batchJobProcessor";
import { processParentChildWithQueues } from "../parentChild/parentChildQueueJob";

class JobManager {
  /**
   * Creates a new job
   * @param jobRequest The request object containing job details
   * @returns The ID of the created job
   */
  async createJob(jobRequest: JobRequest): Promise<string> {
    const jobId = uuidv4();

    // Get the company value from configuration
    const config = await configService.getConfig();
    const company = config.PRIORITY_COMPANY || "";

    await DatabaseService.executeQuery(
      `
    INSERT INTO PriorityJobsHistory (
      JobId, JobName, TableName, ScreenName, StartTime, TotalRecords, 
      Status, ProcessingType, IsParentChildJob, Company, CreatedBy, case_id
    )
    VALUES (
      @JobId, @JobName, @TableName, @ScreenName, @StartTime, @TotalRecords, 
      @Status, @ProcessingType, 0, @Company, @CreatedBy, @CaseId
    )
  `,
      {
        JobId: jobId,
        JobName: jobRequest.jobType,
        TableName: jobRequest.tableName,
        ScreenName: jobRequest.priorityScreenName,
        StartTime: adjustTimeZone(new Date()),
        TotalRecords: jobRequest.recordCount,
        Status: "Queued",
        ProcessingType: jobRequest.processingType || "queue",
        Company: company,
        CreatedBy: "Yotam",
        CaseId: jobRequest.caseId || null,
      }
    );

    return jobId;
  }

  //-------------------------------------------------------------
  /**
   * Updates the status of an existing job
   * @param jobId The ID of the job to update
   * @param status The new status of the job
   * @param totalSuccess The total number of successful records (optional)
   * @param totalFailures The total number of failed records (optional)
   */
  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    totalSuccess?: number,
    totalFailures?: number,
    errorMessage?: string
  ): Promise<void> {
    // Check if the jobId is valid
    const isCompleted =
      status === "Completed" || status === "Failed" || status === "Cancelled";

    let query = `
    UPDATE PriorityJobsHistory 
    SET Status = @Status, SuccessCount = @SuccessCount, FailureCount = @FailureCount, ErrorMessage = @ErrorMessage
  `;

    // Add EndTime only if the job is completed
    if (isCompleted) {
      query += `, EndTime = @EndTime`;
    }

    query += ` WHERE JobId = @JobId`;

    const params: any = {
      JobId: jobId,
      Status: status,
      SuccessCount: totalSuccess ?? 0,
      FailureCount: totalFailures ?? 0,
      ErrorMessage: errorMessage ?? null,
    };

    // Add EndTime only if the job is completed
    if (isCompleted) {
      params.EndTime = adjustTimeZone(new Date());
    }

    await DatabaseService.executeQuery(query, params);
  }

  //-------------------------------------------------------------
  /**
   * Gets the structure of a table to determine which columns it contains
   * @param tableName - The name of the table to check
   * @returns An object with methods to check column existence
   */
  private async getTableStructure(
    tableName: string
  ): Promise<{ hasColumn(name: string): boolean }> {
    try {
      // Query to get column information from SQL Server
      const columns = await DatabaseService.executeQuery(
        `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @TableName
    `,
        {
          TableName: tableName,
        }
      );

      const columnSet = new Set(
        columns.map((col: any) => col.COLUMN_NAME.toLowerCase())
      );

      return {
        hasColumn: (name: string): boolean => columnSet.has(name.toLowerCase()),
      };
    } catch (error) {
      console.error(`Error fetching table structure for ${tableName}:`, error);
      // Return an object that assumes no columns exist
      return {
        hasColumn: () => false,
      };
    }
  }

  //-------------------------------------------------------------
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
    // Use this flag to determine if we should update the batch table
    const updateBatchTable =
      jobRequest.logErrors !== undefined
        ? jobRequest.logErrors
        : !(
            systemConfig.LOG_BATCH_TABLE === 0 ||
            systemConfig.LOG_BATCH_TABLE === "0" ||
            systemConfig.LOG_BATCH_TABLE === false
          );

    // Configure ErrorBufferService based on the logging flag
    ErrorBufferService.getInstance().setLoggingEnabled(logErrors);

    console.log(`Job ${jobId} starting with request:`, {
      recordCount: jobRequest.recordCount,
      tableName: jobRequest.tableName,
      processingType: jobRequest.processingType || "default not set",
      priorityScreenName: jobRequest.priorityScreenName,
      priorityIdField: jobRequest.priorityIdField,
      processAllRecords: jobRequest.processAllRecords,
      caseId: jobRequest.caseId,
      logErrors: logErrors,
    });

    // Determine if this is a delta job
    const isDelta = jobRequest.jobType.toLowerCase().includes("delta");
    console.log(
      `Job ${jobId} is ${isDelta ? "a DELTA job" : "a standard job"}`
    );

    // Update the job status to "Running"
    await this.updateJobStatus(jobId, "Running");

    // Send email notification for job start
    // await this.emailService.sendJobStartNotification({
    //   jobId,
    //   jobType: jobRequest.jobType,
    //   tableName: jobRequest.tableName,
    //   screenName: jobRequest.priorityScreenName,
    //   totalRecords: jobRequest.recordCount,
    // });

    // Get the processing type from the job request or default to system config
    const processingType =
      jobRequest.processingType || (await this.getDefaultProcessingType());

    // Update the job history with the processing type
    await DatabaseService.executeQuery(
      `UPDATE PriorityJobsHistory SET ProcessingType = @ProcessingType WHERE JobId = @JobId`,
      {
        ProcessingType: processingType,
        JobId: jobId,
      }
    );

    // Get custom WHERE clause from config and convert null to undefined for type safety
    const customWhereClauseResult =
      await configService.getWhereClauseForJobType(jobRequest.jobType);
    const customWhereClause =
      customWhereClauseResult === null ? undefined : customWhereClauseResult;
    // console.log(
    //   `Job ${jobId} loaded WHERE clause for ${jobRequest.jobType}: ${customWhereClause || "(none)"}`
    // );

    if (jobRequest.processAllRecords || jobRequest.recordCount === -1) {
      try {
        // Build a more flexible query that doesn't assume specific columns
        let countQuery = `SELECT COUNT(*) as totalCount FROM ${jobRequest.tableName} WHERE 1=1`;

        // Add table-specific conditions if we know the table structure
        const tableInfo = await this.getTableStructure(jobRequest.tableName);

        // For delta jobs, only check is_eligible
        if (isDelta) {
          if (tableInfo.hasColumn("is_eligible")) {
            countQuery += ` AND is_eligible = 1`;
          }
        } else {
          // For regular jobs, check both is_eligible and is_new
          if (tableInfo.hasColumn("is_eligible")) {
            countQuery += ` AND is_eligible = 1`;
          }

          if (tableInfo.hasColumn("is_new")) {
            countQuery += ` AND is_new = 1`;
          }
        }

        if (jobRequest.caseId && tableInfo.hasColumn("case_id")) {
          countQuery += ` AND case_id = @CaseId`;
        }

        // Add custom where clause if provided
        if (customWhereClause) {
          countQuery += ` AND ${customWhereClause}`;
        }

        console.log(
          `Count query for ${isDelta ? "delta" : "standard"} job: ${countQuery}`
        );

        const countResult = await DatabaseService.executeQuery(
          countQuery,
          jobRequest.caseId ? { CaseId: jobRequest.caseId } : undefined
        );

        if (countResult && countResult.length > 0) {
          const totalCount = (countResult[0] as { totalCount: number })
            .totalCount;
          console.log(`Total records for processing: ${totalCount}`);

          if (totalCount === 0) {
            console.warn(
              `No records found matching criteria in ${jobRequest.tableName}. Checking without conditions...`
            );

            // Fallback - try counting without conditions
            const fallbackQuery = `SELECT COUNT(*) as totalCount FROM ${jobRequest.tableName}`;
            const fallbackResult =
              await DatabaseService.executeQuery(fallbackQuery);

            if (fallbackResult && fallbackResult.length > 0) {
              const fallbackCount = (
                fallbackResult[0] as { totalCount: number }
              ).totalCount;
              console.log(`Total records without conditions: ${fallbackCount}`);

              if (fallbackCount > 0) {
                // Proceed with all records if there are any
                jobRequest.recordCount = fallbackCount;
              }
            }
          } else {
            // Update the record count in the job request
            jobRequest.recordCount = totalCount;
          }

          // Also update in the database
          await DatabaseService.executeQuery(
            `UPDATE PriorityJobsHistory SET TotalRecords = @TotalRecords WHERE JobId = @JobId`,
            {
              TotalRecords: jobRequest.recordCount,
              JobId: jobId,
            }
          );
        }
      } catch (error) {
        console.error(`Error getting total record count: ${error}`);
        // Continue with the provided record count as fallback
      }
    }

    try {
      // Start tracking job progress
      if (jobRequest.priorityLinkedField) {
        // If there's a linked field, we need to track progress
        const childJobs = (await DatabaseService.executeQuery(
          `SELECT ChildJobeId, JobTypeName, DBTableName, ScreenName, priority_id, HasSiblings 
         FROM PriorityChildJob 
         WHERE refParentJobId = @JobTypeId`,
          {
            JobTypeId: jobRequest.priorityJobTypeId,
          }
        )) as ChildJob[];

        const childJobCount = childJobs.length;

        // Log the child jobs for debugging
        // 26_05_2025 if (childJobCount > 0 && processingType === "batch") {
        if (childJobCount > 0) {
          // console.log(`Job ${jobId} executing parent-child batch processing`);

          // Mark the job as a parent-child job to prevent separate jobs from being created for child tables
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

          results = await processParentChildWithQueues(
            jobRequest.recordCount,
            jobRequest.startRow,
            jobRequest.tableName,
            jobRequest.priorityScreenName,
            jobRequest.jobType,
            jobId,
            jobRequest.priorityIdField,
            jobRequest.priorityLinkedField,
            childJobs,
            logErrors,
            updateBatchTable,
            customWhereClause,
            jobRequest.caseId
          );

          // Reset error buffer configuration to default after parent-child processing
          ErrorBufferService.getInstance().configure({
            flushSize: 500,
            minFlushSize: 100,
            flushInterval: 30000,
          });
        } else {
          // If there are no child jobs or it's not batch processing, perform standard processing
          console.log(
            `Job ${jobId} has parent-child relationship but using standard processing (${processingType})`
          );
          results = await this.executeStandardProcessing(
            jobId,
            jobRequest,
            processingType,
            logErrors,
            updateBatchTable
          );
        }
      } else {
        // If there are no parent-child relationships, perform standard processing
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

      //------------------
      // Check if job was cancelled during execution
      if (JobCancellationService.isCancellationRequested(jobId)) {
        console.log(`Job ${jobId} was cancelled by user request - cleaning up`);

        // Update job status to "Cancelled" (you'll need to add this status to your JobStatus type)
        await this.updateJobStatus(
          jobId,
          "Cancelled",
          results
            ? results.reduce(
                (acc: number, result: JobResult) =>
                  acc +
                  (typeof result.successCount === "number"
                    ? result.successCount
                    : 0),
                0
              )
            : 0,
          results
            ? results.reduce(
                (acc: number, result: JobResult) =>
                  acc +
                  (typeof result.failureCount === "number"
                    ? result.failureCount
                    : 0),
                0
              )
            : 0,
          "Job cancelled by user request"
        );

        // Clean up cancellation status
        JobCancellationService.clearCancellationRequest(jobId);

        return { cancelled: true, results };
      }
      //------------------

      // Calculate success and failure statistics
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

      // End job progress tracking
      ProgressTracker.completeJob(jobId, totalSuccess, totalFailures);

      const jobDurationSec = ((Date.now() - jobStartTime) / 1000).toFixed(2);

      // Send email notification for job completion
      // await this.emailService.sendJobCompletionNotification({
      //   jobId,
      //   jobType: jobRequest.jobType,
      //   tableName: jobRequest.tableName,
      //   screenName: jobRequest.priorityScreenName,
      //   totalRecords: jobRequest.recordCount,
      //   successCount: totalSuccess,
      //   failureCount: totalFailures,
      //   status: "Completed",
      //   duration: `${jobDurationSec} שניות`,
      // });

      // Update the job status to "Completed"
      await this.updateJobStatus(
        jobId,
        "Completed",
        totalSuccess,
        totalFailures,
        totalFailures > 0 ? "Some records failed" : undefined
      );

      // Print performance statistics
      // const jobEndTime = Date.now();
      // const jobDurationSec = ((jobEndTime - jobStartTime) / 1000).toFixed(2);

      console.log(
        `Job ${jobId} completed in ${jobDurationSec} seconds. Results: Success: ${totalSuccess}, Failures: ${totalFailures}`
      );

      return results;
    } catch (error) {
      // Catch any errors during job processing
      console.error(`Job ${jobId} failed with error:`, error);

      // Ensure errors are flushed even on job failure
      try {
        await ErrorBufferService.getInstance().flushAll();
      } catch (flushError) {
        console.error("Error flushing error buffer:", flushError);
      }

      // Update the job status to "Failed"
      await this.updateJobStatus(
        jobId,
        "Failed",
        0,
        jobRequest.recordCount,
        error instanceof Error ? error.message : "Unknown error"
      );

      // Clean up cancellation status even on error
      if (JobCancellationService.isCancellationRequested(jobId)) {
        JobCancellationService.clearCancellationRequest(jobId);
      }

      // Send email notification for job failure
      //const jobDurationSec = ((Date.now() - jobStartTime) / 1000).toFixed(2);
      // await this.emailService.sendJobCompletionNotification({
      //   jobId,
      //   jobType: jobRequest.jobType,
      //   tableName: jobRequest.tableName,
      //   screenName: jobRequest.priorityScreenName,
      //   totalRecords: jobRequest.recordCount,
      //   successCount: 0,
      //   failureCount: jobRequest.recordCount,
      //   status: "Failed",
      //   duration: `${jobDurationSec} שניות`,
      //   // Include error message in the notification
      // });

      throw error;
    }
  }

  //-------------------------------------------------------------
  /**
   *
   * @param jobId
   * @param jobRequest
   * @param processingType
   * @param logErrors
   * @param updateBatchTable
   * @returns
   */
  private async executeStandardProcessing(
    jobId: string,
    jobRequest: JobRequest,
    processingType: string,
    logErrors: boolean = false,
    updateBatchTable: boolean = false
  ): Promise<any> {
    console.log(
      `Job ${jobId} starting ${processingType} processing with error logging: ${logErrors ? "enabled" : "disabled"}`
    );

    // Initialize job progress tracking
    ProgressTracker.initJob(jobId, jobRequest.recordCount, jobRequest.jobType);

    const batchStartTime = Date.now();
    console.log(
      `Job ${jobId} starting processing at: ${new Date().toISOString()}`
    );

    let results;

    // Get custom WHERE clause from config and convert null to undefined for type safety
    const customWhereClauseResult =
      await configService.getWhereClauseForJobType(jobRequest.jobType);
    const customWhereClause =
      customWhereClauseResult === null ? undefined : customWhereClauseResult;

    // console.log(
    //   `JobManager retrieved WHERE clause for ${jobRequest.jobType}: ${customWhereClause || "(none)"}`
    // );
    if (processingType === "queue") {
      // Process using queues
      results = await processWithQueues(
        jobRequest.recordCount,
        jobRequest.startRow,
        jobRequest.tableName,
        jobRequest.priorityScreenName,
        jobRequest.jobType,
        jobId,
        jobRequest.priorityIdField,
        logErrors,
        updateBatchTable,
        customWhereClause,
        jobRequest.caseId
      );
    } else {
      // Process in batches
      results = await processBatches(
        jobRequest.recordCount,
        jobRequest.startRow,
        jobRequest.tableName,
        jobRequest.priorityScreenName,
        jobRequest.jobType,
        jobId,
        jobRequest.priorityIdField,
        logErrors,
        updateBatchTable,
        customWhereClause,
        jobRequest.caseId
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

  //-------------------------------------------------------------
  /**
   * Starts multiple jobs concurrently
   * @param jobRequests An array of job request objects
   * @returns An array of results for each job
   */
  async startMultipleJobs(jobRequests: JobRequest[]): Promise<any[]> {
    const results = [];
    for (const request of jobRequests) {
      const jobId = await this.createJob(request);
      const result = await this.startJob(jobId, request);
      results.push({ jobId, result });
    }
    return results;
  }

  //-------------------------------------------------------------
  /**
   * Retrieves the default processing type from system configuration
   * @returns The default processing type as a string
   */
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
