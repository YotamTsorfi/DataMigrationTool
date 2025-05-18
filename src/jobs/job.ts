// job.ts - Main orchestration file

import { config } from "../config/config";
import { configService } from "../config/configService";
import ProgressTracker from "../utils/progressTracker";
import PerformanceMonitor from "../utils/performanceMonitor";
import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";
import {
  fetchDataChunk,
  performBulkUpdateWithService,
  recordBatchProcessing,
} from "../services/dataService";
import {
  buildBatchRequestBody,
  createBatchHeaders,
  generateBoundary,
} from "../services/requestBuilder";
import {
  sendBatchRequest,
  processApiResponse,
  measureRequestPerformance,
  measureResponsePerformance,
} from "../services/requestSender";
import { ErrorBufferService } from "../utils/errorBufferService";

interface BatchCreateRowsResult {
  success: boolean;
  message?: string;
  rowsCount?: number;
  responseStats?: any;
  requestSize?: number;
  responseSize?: number;
  duration?: number;
  averageTimePerRecord?: string;
  error?: string;
  details?: string;
  performanceMetrics?: {
    dbFetchTime?: string;
    dbUpdateTime?: string;
    batchBuildTime?: string;
    requestTime?: string;
    totalDuration?: string;
  };
  [key: string]: any; // Add index signature to allow arbitrary string keys
}

const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

//--------------------------------------------------------------------------------
/**
 * Process a batch of rows by sending them to Priority API
 */
async function processBatch(
  rows: any[],
  batchId: string,
  jobType: string,
  tableName: string,
  priorityScreenName: string,
  jobId: string,
  dbFetchTime?: number,
  priorityIdField?: string
): Promise<BatchCreateRowsResult> {
  //TODO
  // console.log(`processBatch called with priorityIdField: [${priorityIdField}]`);

  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  if (dbFetchTime !== undefined) {
    perfMonitor.setDbFetchTime(dbFetchTime);
  }

  try {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Invalid rows data");
    }

    // Measure batch build time
    perfMonitor.startBatchBuild();
    // Add metadata to rows for processing
    const enrichedRows = rows.map((row) => ({
      ...row,
      __batchId: batchId,
      __jobType: jobType,
      __tableName: tableName,
      __jobId: jobId,
      __priorityScreenName: priorityScreenName,
    }));

    // Measure request performance
    measureRequestPerformance(enrichedRows, perfMonitor);

    // Build request body
    const boundary = generateBoundary();
    const batchBody = buildBatchRequestBody(enrichedRows, boundary);

    // Create headers with authentication
    const headers = createBatchHeaders(
      boundary,
      `Basic ${Buffer.from(`${config.priorityPAT}:${config.priorityPassword}`).toString("base64")}`
    );
    perfMonitor.endBatchBuild();

    // Measure request time
    perfMonitor.startRequest();

    // Send the request
    let response;
    try {
      response = await sendBatchRequest(batchBody, headers);
      perfMonitor.endRequest();
      // Measure response performance
      measureResponsePerformance(response, perfMonitor);
    } catch (error) {
      perfMonitor.logError(error);
      console.error("Error sending batch request:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        details: "Failed to communicate with Priority API",
      };
    }

    // Process API response
    const {
      updateRows,
      errorRows,
      successCount,
      failureCount,
      lastProcessedIndex,
      sentToPriority,
    } = processApiResponse(response, enrichedRows, priorityIdField);

    // Update performance metrics
    perfMonitor.metrics.successCount = successCount;
    perfMonitor.metrics.failureCount = failureCount;
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // Track all DB update operations
    let totalDbUpdateTime = 0;
    // If we sent to Priority successfully, mark batch as Completed regardless of response details
    let batchStatus = sentToPriority ? "Completed" : "Failed";
    let hadDeadlocks = false;

    // Perform bulk operations with the performance monitor
    if (updateRows.length > 0) {
      try {
        const result = await performBulkUpdateWithService(
          tableName,
          updateRows,
          perfMonitor,
          undefined,
          3, // number of retries
          sentToPriority // sentToPriority is used to determine if we should log deadlocks
        );

        totalDbUpdateTime += result.updateTime;
        hadDeadlocks = result.hadDeadlocks;

        // If we had deadlocks but were still successful, maintain the Completed status
        if (hadDeadlocks && result.successful && sentToPriority) {
          batchStatus = "Completed";
          console.log(
            `Batch ${batchId} had deadlocks during DB update but completed successfully`
          );
        }
      } catch (dbError) {
        console.error("Error during database update:", dbError);

        // Check if the error was due to a deadlock
        const isDeadlock =
          (dbError as any)?.number === 1205 ||
          (dbError as any)?.originalError?.info?.number === 1205 ||
          (dbError instanceof Error && dbError.message.includes("deadlock"));

        if (isDeadlock && sentToPriority) {
          console.log(
            `Batch ${batchId} was sent to Priority but failed DB update due to deadlock`
          );

          // Use "Completed" with explanatory error message
          batchStatus = "Completed";
        } else {
          throw dbError;
        }
      }
    }

    // Update error handling to use buffer instead of immediate insert
    if (errorRows.length > 0) {
      try {
        // Add errors to buffer instead of immediately inserting
        ErrorBufferService.getInstance().addErrors(errorRows);
      } catch (errorBufferError) {
        console.error("Failed to buffer error logs:", errorBufferError);
      }
    }

    // If we tracked update time separately, make sure it's recorded in case perfMonitor didn't track it
    if (totalDbUpdateTime > 0 && !perfMonitor.metrics.dbUpdateTime) {
      perfMonitor.setDbUpdateTime(totalDbUpdateTime);
    }

    perfMonitor.endOperation();

    // Get formatted metrics for the result
    const formattedMetrics = perfMonitor.getFormattedMetrics();

    // Extract important information from response before clearing it
    const responseStats = {
      successCount: perfMonitor.metrics.successCount,
      failureCount: perfMonitor.metrics.failureCount,
      responseCount: response.data?.responses?.length || 0,
    };

    // Ensure the status is correctly reported
    if (batchStatus === "PartialSync") {
      // For PartialSync status, count as success but note the deadlock
      perfMonitor.metrics.successCount = rows.length;
      perfMonitor.metrics.failureCount = 0;
      responseStats.successCount = rows.length;
      responseStats.failureCount = 0;
    }

    // Record batch processing results with the appropriate status
    await recordBatchProcessing(
      jobType,
      batchId,
      jobId,
      adjustTimeZone(new Date(perfMonitor.metrics.startTime)),
      adjustTimeZone(new Date(perfMonitor.metrics.endTime)),
      rows.length,
      perfMonitor.metrics.successCount,
      perfMonitor.metrics.failureCount,
      perfMonitor.metrics.lastProcessedIndex,
      batchStatus, // Completed or Failed
      hadDeadlocks
        ? "DB update had deadlocks but completed successfully"
        : null,
      tableName
    );

    // Clear large response data to help garbage collection
    if (response && response.data) {
      response.data = null;
    }

    return {
      success: true,
      message: "Batch created successfully",
      rowsCount: rows.length,
      responseStats: {
        // successCount: sentToPriority ? rows.length : 0,
        // failureCount: sentToPriority ? 0 : rows.length,
        // responseCount: response.data?.responses?.length || 0,
        successCount: successCount,
        failureCount: failureCount,
        responseCount: response.data?.responses?.length || 0,
      },
      requestSize: perfMonitor.metrics.requestSize,
      responseSize: perfMonitor.metrics.responseSize,
      duration: perfMonitor.metrics.duration,
      averageTimePerRecord: formattedMetrics.averageTimePerRecord,
      performanceMetrics: {
        dbFetchTime: formattedMetrics.dbFetchTime,
        dbUpdateTime: formattedMetrics.dbUpdateTime,
        batchBuildTime: formattedMetrics.batchBuildTime,
        requestTime: formattedMetrics.requestTime,
        totalDuration: formattedMetrics.totalDuration,
      },
    };
  } catch (error) {
    perfMonitor.logError(error);
    console.error("Error in processBatch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
//--------------------------------------------------------------------------------
/**
 * Process multiple batches of records
 */
async function processBatches(
  recordCount: number,
  startRow: number,
  tableName: string,
  priorityScreenName: string,
  jobType: string,
  jobId: string,
  priorityIdField: string
): Promise<any[]> {
  const config = await configService.getConfig();
  const BATCH_SIZE = config.BATCH_SIZE;
  const CONCURRENT_BATCHES = config.CONCURRENT_BATCHES;
  const DELAY_BETWEEN_BATCHES = config.DELAY_BETWEEN_BATCHES;
  const MIN_DELAY = config.MIN_DELAY || 100; // Minimum delay in milliseconds
  const MAX_DELAY = config.MAX_DELAY || 500; // Maximum delay in milliseconds
  const limit = pLimit(CONCURRENT_BATCHES);

  // Configure error buffer service with appropriate size based on configuration
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: Math.max(5000, BATCH_SIZE * 10), // Appropriate buffer size based on batch size
    flushInterval: 5000, // Flush at least every 5 seconds if not triggered by size
  });

  // const memoryMonitor = setInterval(() => {
  //   const memoryUsage = process.memoryUsage();
  //   if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9) {
  //     // 90% memory usage
  //     console.warn("Memory usage is high, consider reducing batch size");
  //     // Optionally implement some throttling mechanism
  //   }
  // }, 10000); // Check every 10 seconds

  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount);

  // Track overall progress
  let totalProcessedRecords = 0;
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  const results = [];

  // Process in chunks
  const CHUNK_SIZE = 1000;
  let processedCount = 0;
  let lastRowId = startRow - 1;

  try {
    while (processedCount < recordCount) {
      const chunkSize = Math.min(CHUNK_SIZE, recordCount - processedCount);

      // Measure DB fetch time - Now properly measured for the chunk
      const perfMonitor = new PerformanceMonitor();
      perfMonitor.startDbFetch();

      // Fetch data chunk from database
      const rows = await fetchDataChunk(tableName, lastRowId, chunkSize);
      perfMonitor.endDbFetch();

      // console.log(
      //   `Fetched ${rows.length} rows from database in ${perfMonitor.metrics.dbFetchTime?.toFixed(2)}ms`
      // );

      if (rows.length === 0) break;

      const batchPromises = [];
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const batchId = uuidv4();
        batchPromises.push(
          limit(() =>
            processBatch(
              batch,
              batchId,
              jobType,
              tableName,
              priorityScreenName,
              jobId,
              perfMonitor.metrics.dbFetchTime,
              priorityIdField
            )
          )
        );
      }

      let currentDelay = DELAY_BETWEEN_BATCHES;
      for (const batchPromise of batchPromises) {
        try {
          const startTime = Date.now();
          const result = await batchPromise;
          const processingTime = Date.now() - startTime;

          // Store only essential information from the result
          results.push({
            success: result.success,
            rowsCount: result.rowsCount || 0,
            successCount: result.responseStats?.successCount || 0,
            failureCount: result.responseStats?.failureCount || 0,
            duration: result.duration,
          });

          // Update progress metrics after each batch completes
          // if (result.success) {
          //   totalProcessedRecords += result.rowsCount || 0;
          //   totalSuccessCount += result.responseStats?.successCount || 0;
          //   totalFailureCount += result.responseStats?.failureCount || 0;
          // }
          totalProcessedRecords += result.rowsCount || 0;
          totalSuccessCount += result.responseStats?.successCount || 0;
          totalFailureCount += result.responseStats?.failureCount || 0;

          // Help garbage collector by clearing references to the full result
          Object.keys(result).forEach((key) => {
            if (key !== "success" && key !== "error") {
              result[key] = null;
            }
          });

          // Adjust delay based on processing time
          if (processingTime > currentDelay) {
            currentDelay = Math.min(currentDelay * 1.5, MAX_DELAY); // Slow down
          } else if (processingTime < currentDelay / 2) {
            currentDelay = Math.max(currentDelay * 0.8, MIN_DELAY); // Speed up
          }
        } catch (error) {
          console.error("Batch processing failed:", error);
          // Add the failed result with error details
          const failedBatchSize = BATCH_SIZE;
          results.push({
            success: false,
            error:
              error instanceof Error ? error.message : "Unknown batch error",
            rowsCount: failedBatchSize,
          });

          // Continue with next batch instead of failing the entire job
          // totalFailureCount += BATCH_SIZE; // Estimate failure count
          // Update both processedRecords and failures
          totalProcessedRecords += failedBatchSize;
          totalFailureCount += failedBatchSize;
        }

        // Update progress tracker (moved outside try/catch to ensure it always runs)
        ProgressTracker.updateProgress(
          jobId,
          totalProcessedRecords,
          totalSuccessCount,
          totalFailureCount
        );

        await new Promise((resolve) => setTimeout(resolve, currentDelay));
      }

      lastRowId = (rows[rows.length - 1] as { RowId: number }).RowId;
      processedCount += rows.length;

      // Clear row data to help garbage collection
      rows.length = 0;
    }

    // Make sure to flush any remaining errors before completing the job
    await errorBuffer.flushAll();

    // Mark job as complete when all batches are done
    ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

    // Return lightweight results
    return results.map((result) => ({
      success: result.success,
      rowsCount: result.rowsCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      duration: result.duration,
    }));
  } catch (error) {
    // Ensure all errors are flushed even if job fails
    await errorBuffer.flushAll();
    throw error;
  }
}

export { processBatch, processBatches };
