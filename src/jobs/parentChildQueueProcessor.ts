/**
 * This module provides a specialized processor for parent-child record structures using queues.
 * It implements a grid-based approach with horizontal parallelism (multiple queues) and vertical
 * batching (grouped records within each queue) to optimize processing throughput.
 */

import { v4 as uuidv4 } from "uuid";
import { QueueProcessor, QueueItem } from "../services/queueProcessor";
import { fetchParentChildChunk } from "../services/parentChildChunkFetcher";

//import { sendParentChildBatch } from "../services/priorityParentChildBatchSender";
import { sendParentChildQueue } from "../services/priorityParentChildQueueSender";

import { performBulkUpdateWithService } from "../services/dataService";
import { configService } from "../config/configService";

import PerformanceMonitor from "../utils/performanceMonitor";
import ProgressTracker from "../utils/progressTracker";
import { ErrorBufferService } from "../utils/errorBufferService";
import { JobCancellationService } from "../utils/jobCancellationService";
import { ChildJob } from "./jobParentAndChilds";

/**
 * Interface for batch processing results
 */
interface BatchResult {
  success: boolean;
  successCount?: number;
  failureCount?: number;
  error?: any;
  rowsCount?: number;
  duration?: number;
  totalProcessed?: number;
}

/**
 * Generates a clean error message by removing numbers and special characters,
 * while preserving Hebrew and English letters and spaces.
 */
function generateCleanError(errorMessage: string | null): string | null {
  if (!errorMessage) return null;
  return errorMessage
    .replace(/[0-9]/g, "") // Remove all numbers
    .replace(/[^\p{L}\s]/gu, "") // Keep only letters (including Hebrew/English) and spaces
    .trim();
}

/**
 * Updates database with error information for a failed record
 */
async function forceErrorRecordUpdate(
  record: any,
  batchId: string,
  jobType: string,
  jobId: string,
  tableName: string,
  error: any
): Promise<void> {
  try {
    // Format the error message
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cleanErrorMessage = generateCleanError(errorMessage);

    // Add truncation to ensure it fits in the database column
    const truncatedError = truncateErrorForDatabase(cleanErrorMessage, 500);

    // Update record with error information
    await performBulkUpdateWithService(tableName, [
      {
        setClause:
          "PriorityStatus = 0, ErrorMessage = ?, ProcessingStatus = 'Error'",
        params: [truncatedError || "Unknown error"],
        where: `RowId = ?`,
        whereParams: [record.RowId],
      },
    ]);
  } catch (updateError) {
    console.error(
      `Failed to update error information for record ${record.RowId}:`,
      updateError
    );
  }
}

/**
 * Retry utility with exponential backoff for handling transient errors like HTTP 502.
 * Retries the provided async function up to maxRetries times, doubling the delay each time.
 */
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> => {
  let attempt = 0;
  let delay = initialDelay;
  let lastError: any = null;

  // Limit the loop by checking the attempt count
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      lastError = error;
      // Only retry on 502 or ERR_BAD_RESPONSE
      const is502 =
        error?.response?.status === 502 ||
        error?.code === "ERR_BAD_RESPONSE" ||
        (typeof error?.message === "string" && error.message.includes("502"));
      if (attempt > maxRetries || !is502) {
        throw error;
      }
      console.warn(
        `Retry attempt ${attempt} after 502 error: ${error.message || error}. Waiting ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  // If all retries failed, throw the last error
  throw lastError;
};

/**
 * Ensures error messages don't exceed database column size limits.
 * Handles Redis timeout errors and other common API issues while preserving essential information.
 *
 * @param errorMessage - The original error message
 * @param maxLength - Maximum allowed length (default 500 characters)
 * @returns Truncated and formatted error message
 */
function truncateErrorForDatabase(
  errorMessage: string | null,
  maxLength: number = 500
): string | null {
  if (!errorMessage) return null;

  try {
    // Check if it's a JSON error and extract just the essential parts
    if (errorMessage.startsWith("{") && errorMessage.includes('"code"')) {
      try {
        const errorObj = JSON.parse(errorMessage);
        // Extract just the code and a shortened message
        return `Error ${errorObj.code || "Unknown"}: ${(errorObj.message || "").substring(0, maxLength - 20)}`;
      } catch (e) {
        // If JSON parsing fails, continue with normal truncation
      }
    }

    // Handle Redis timeout errors specifically - they tend to be very long
    if (
      errorMessage.includes("Timeout performing") &&
      errorMessage.includes("HGET")
    ) {
      return "Redis timeout error - operation took too long to complete";
    }

    // For other errors, just truncate to fit the column
    return errorMessage.substring(0, maxLength);
  } catch (e) {
    // Failsafe - if anything goes wrong in error processing, return a safe message
    return "Error message processing failed";
  }
}

/**
 * Process parent-child records using grid-based processing (horizontal parallel, vertical sequential)
 * This implementation follows the same approach as processWithQueues but adapts it for parent-child relationships
 */
export async function processParentChildWithQueues(
  totalRecords: number,
  startRow: number,
  parentTableName: string,
  parentScreenName: string,
  jobType: string,
  jobId: string,
  parentIdField: string,
  linkedField: string,
  childJobs: ChildJob[],
  logErrors: boolean = false,
  updateBatchTable: boolean = false,
  customWhereClause?: string
): Promise<BatchResult[]> {
  console.log(
    "------------- PARENT-CHILD GRID PROCESSING --------------------"
  );
  console.log("Parent job details:");
  console.log(`  Table Name: ${parentTableName}`);
  console.log(`  Screen Name: ${parentScreenName}`);
  console.log(`  Parent ID Field: ${parentIdField}`);
  console.log(`  Linked Field: ${linkedField}`);
  console.log(`  Job Type: ${jobType}`);
  console.log(`  Child Jobs: ${childJobs.length}`);
  console.log(
    "---------------------------------------------------------------"
  );

  // Get system configuration
  const config = await configService.getConfig();

  // Initialize error buffer service
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: 1000,
    minFlushSize: 200,
    flushInterval: 60000,
  });
  errorBuffer.setLoggingEnabled(logErrors);

  // Set horizontal and vertical batch sizes from configuration or use defaults
  const HORIZONTAL_BATCH_SIZE = parseInt(
    config.HORIZONTAL_BATCH_SIZE || "40", // Changed to match processWithQueues default
    10
  );
  // Add VERTICAL_BATCH_SIZE same as in processWithQueues
  const VERTICAL_BATCH_SIZE = parseInt(
    config.VERTICAL_BATCH_SIZE || "1000",
    10
  );
  // Updated chunk size to match processWithQueues
  const CHUNK_SIZE = 50000;

  // Initialize progress tracking
  ProgressTracker.initJob(jobId, totalRecords, jobType);
  const overallPerformance = new PerformanceMonitor();
  overallPerformance.startOperation();

  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results: BatchResult[] = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  let totalProcessedRecords = 0;

  const childTableNames = childJobs.map((job) => job.DBTableName);

  try {
    while (processedCount < totalRecords) {
      // Check for cancellation before processing each chunk
      if (JobCancellationService.isCancellationRequested(jobId)) {
        console.log(`Job ${jobId} cancelled - stopping queue processing`);
        break; // Exit the processing loop
      }

      const chunkSize = Math.min(CHUNK_SIZE, totalRecords - processedCount);

      // Get custom WHERE clause from config if not provided directly
      if (!customWhereClause) {
        const clause = await configService.getWhereClauseForJobType(jobType);
        customWhereClause = clause === null ? undefined : clause;
      }

      // Fetch data chunk from database
      const perfMonitor = new PerformanceMonitor();
      perfMonitor.startDbFetch();
      const rows = await fetchParentChildChunk(
        parentTableName,
        chunkSize,
        lastRowId,
        chunkSize,
        linkedField,
        childJobs,
        perfMonitor,
        customWhereClause
      );
      perfMonitor.endDbFetch();

      if (rows.length === 0) break;

      // Divide the rows into horizontal and vertical batches (same as in processWithQueues)
      for (
        let i = 0;
        i < rows.length;
        i += HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE
      ) {
        // Check for cancellation before processing each horizontal batch
        if (JobCancellationService.isCancellationRequested(jobId)) {
          console.log(`Job ${jobId} cancelled - stopping queue processing`);
          break; // Exit the batch processing loop
        }

        const horizontalBatch = rows.slice(
          i,
          i + HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE
        );

        // Enhanced load-balancing implementation

        // Create queue processors for horizontal batches
        const horizontalQueues: QueueProcessor[] = [];
        for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
          const queue = new QueueProcessor(
            `queue-${h}`,
            jobId,
            jobType,
            parentTableName
          );
          queue.setRateLimitEnabled(true);
          queue.setUpdateBatchTable(updateBatchTable);
          horizontalQueues.push(queue);
        }

        // Initialize tracking for workload distribution
        const queueWorkloads = new Map<number, number>();
        for (let q = 0; q < horizontalQueues.length; q++) {
          queueWorkloads.set(q, 0);
        }

        // Divide the horizontal batch into vertical batches
        for (
          let v = 0;
          v < Math.ceil(horizontalBatch.length / VERTICAL_BATCH_SIZE);
          v++
        ) {
          const startIndex = v * VERTICAL_BATCH_SIZE;
          const verticalBatch = horizontalBatch.slice(
            startIndex,
            startIndex + VERTICAL_BATCH_SIZE
          );

          if (verticalBatch.length === 0) continue;

          // Find the queue with the least workload
          let targetQueueIndex = 0;
          let minWorkload = Number.MAX_SAFE_INTEGER;

          for (let q = 0; q < horizontalQueues.length; q++) {
            const workload = queueWorkloads.get(q) || 0;
            if (workload < minWorkload) {
              minWorkload = workload;
              targetQueueIndex = q;
            }
          }

          // Add all rows from the vertical batch to the selected queue
          const queueItems: QueueItem[] = verticalBatch.map((row, vIndex) => {
            const batchId = uuidv4();

            return {
              row,
              index: i + startIndex + vIndex + processedCount,
              queueId: `queue-${targetQueueIndex}`,
              jobId,
              batchId,
              jobType,
              tableName: parentTableName,
              priorityScreenName: parentScreenName,
              priorityIdField: parentIdField,
              childJobs,
              childTableNames,
            };
          });

          // Add the items to the queue
          horizontalQueues[targetQueueIndex].addItems(queueItems);

          // Update workload tracker
          queueWorkloads.set(
            targetQueueIndex,
            (queueWorkloads.get(targetQueueIndex) || 0) + verticalBatch.length
          );
        }

        // Track progress updates from all queues
        const progressUpdates = new Map<
          string,
          { success: number; failure: number }
        >();

        // Process each queue in parallel - each queue processes its vertical batch in order
        const queuePromises = horizontalQueues
          .filter((q) => q.hasItems()) // Just process queues with items
          .map((queue) => {
            // Check for cancellation before processing each horizontal batch
            if (JobCancellationService.isCancellationRequested(jobId)) {
              console.log(`Job ${jobId} cancelled - stopping queue processing`);
              return Promise.resolve({
                success: false,
                totalProcessed: 0,
                successCount: 0,
                failureCount: 0,
                duration: 0,
              });
            }

            const queueId = queue.getQueueId();
            queue.setProgressListener((success, failure) => {
              progressUpdates.set(queueId, { success, failure });

              // Calculate total across all queues
              let currentSuccess = 0;
              let currentFailure = 0;

              progressUpdates.forEach((update) => {
                currentSuccess += update.success;
                currentFailure += update.failure;
              });

              // Update overall progress tracker
              ProgressTracker.updateProgress(
                jobId,
                totalProcessedRecords + currentSuccess + currentFailure,
                totalSuccessCount + currentSuccess,
                totalFailureCount + currentFailure
              );
            });

            // Use custom item processor for parent-child relationships
            queue.setItemProcessor(async (item: QueueItem) => {
              try {
                const result = await retryWithBackoff(
                  () =>
                    // sendParentChildBatch(
                    sendParentChildQueue(
                      item.row,
                      jobType,
                      parentTableName,
                      parentScreenName,
                      jobId,
                      parentIdField,
                      childTableNames,
                      childJobs,
                      logErrors,
                      updateBatchTable
                    ),
                  3, // maxRetries
                  1000 // initialDelay ms
                );

                // Check if API request was successful, not just if the error processing was successful
                // Fix: Ensure status is a number and explicitly convert result to boolean
                const status = result.status || 0;
                const isApiSuccess = Boolean(
                  result.success && status >= 200 && status < 300
                );

                return {
                  success: isApiSuccess, // Now guaranteed to be a boolean
                  error: isApiSuccess
                    ? undefined
                    : result.error || `Status code ${status || 400}`,
                  responseStats: {
                    successCount: isApiSuccess ? result.successCount : 0,
                    failureCount: isApiSuccess ? 0 : 1,
                    status: result.status,
                    errorData: result.errorData,
                    priorityId: result.priorityId,
                  },
                };
              } catch (error) {
                // Error handling remains unchanged
                console.error(
                  `Error processing parent-child record in queue:`,
                  error
                );
                await forceErrorRecordUpdate(
                  item.row,
                  item.batchId,
                  jobType,
                  jobId,
                  parentTableName,
                  error
                );
                return {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                  responseStats: {
                    successCount: 0,
                    failureCount: 1,
                  },
                };
              }
            });

            return queue.process();
          });

        const queueResults = await Promise.all(queuePromises);

        // Aggregate results from all queues
        for (let qIndex = 0; qIndex < queueResults.length; qIndex++) {
          const result = queueResults[qIndex];
          results.push(result);
          totalSuccessCount += result.successCount;
          totalFailureCount += result.failureCount;
        }

        progressUpdates.clear();

        // Update progress tracker with the total processed count
        ProgressTracker.updateProgress(
          jobId,
          totalProcessedRecords + totalSuccessCount + totalFailureCount,
          totalSuccessCount,
          totalFailureCount
        );
      }

      // Update the last processed row ID for the next chunk
      if (rows.length > 0) {
        lastRowId = Math.max(...rows.map((row) => row.RowId));
      }
      processedCount += rows.length;
      totalProcessedRecords = processedCount;

      // Ensure we're flushing errors regularly
      if (totalFailureCount > 0 && totalFailureCount % 500 === 0) {
        await errorBuffer.flush();
      }

      // Clear rows array to help with garbage collection
      rows.length = 0;
    }

    // Make sure to flush any remaining errors before completing
    await errorBuffer.flushAll();

    // Finalize progress tracking for this job
    ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

    overallPerformance.endOperation();
    const metrics = overallPerformance.getFormattedMetrics();

    console.log(
      `Parent-child grid job completed: ${processedCount} records (${totalSuccessCount} success, ${totalFailureCount} failed), duration: ${metrics.totalDuration}`
    );

    // Return only the summary of results for each queue
    return results.map((result) => ({
      success: result.success,
      successCount: result.successCount || 0,
      failureCount: result.failureCount || 0,
      rowsCount: result.totalProcessed || 0,
      duration: result.duration,
    }));
  } catch (error) {
    console.error(`Fatal error in processParentChildWithQueues:`, error);

    await errorBuffer.flushAll();

    ProgressTracker.completeJob(
      jobId,
      totalSuccessCount,
      totalFailureCount + (totalRecords - processedCount)
    );

    return [
      {
        success: false,
        successCount: totalSuccessCount,
        failureCount: totalFailureCount + (totalRecords - processedCount),
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
