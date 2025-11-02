/**
 * This module provides a specialized processor for parent-child record structures using queues.
 * It implements a grid-based approach with horizontal parallelism (multiple queues) and vertical
 * batching (grouped records within each queue) to optimize processing throughput.
 */
import { v4 as uuidv4 } from "uuid";
import { QueueItem } from "../../types/jobTypes";
import { ChildJob, BatchResult } from "../../types/jobTypes";
import { configService, ConfigChangeEvent } from "../../config/configService";
import ProgressTracker from "../../utils/progressTracker";
import PerformanceMonitor from "../../utils/performanceMonitor";
import { JobCancellationService } from "../../utils/jobCancellationService";
import { ErrorBufferService } from "../../utils/errorBufferService";
import {
  generateCleanError,
  truncateErrorForDatabase,
} from "../../utils/errorUtils";
import { QueueProcessor } from "../../services/processing/queue/queueProcessor";
import { fetchParentChildChunk } from "../../services/priority/queue/chunkFetcher";
import { sendParentChildQueue } from "../../services/priority/queue/queueSender";
import { DatabaseService } from "../../services/database/databaseService";
import { writeToLogFile } from "../../config/logger";

// Define the config log file name
const CONFIG_LOG_FILE = "config_changes.log";

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
  customWhereClause?: string,
  caseId?: string
): Promise<BatchResult[]> {
  // Get system configuration
  const config = await configService.getConfig();

  // Initialize error buffer service
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: 2000,
    minFlushSize: 500,
    flushInterval: 120000,
  });
  errorBuffer.setLoggingEnabled(logErrors);

  // Initial configuration
  let HORIZONTAL_BATCH_SIZE = parseInt(
    config.HORIZONTAL_BATCH_SIZE || "40",
    10
  );
  let VERTICAL_BATCH_SIZE = parseInt(config.VERTICAL_BATCH_SIZE || "1000", 10);
  let QUEUE_RATE_LIMIT = parseInt(config.QUEUE_RATE_LIMIT || "1000", 10);
  let QUEUE_MIN_DELAY = parseInt(config.QUEUE_MIN_DELAY || "30", 10);
  let QUEUE_CONCURRENT_ITEMS = parseInt(
    config.QUEUE_CONCURRENT_ITEMS || "500",
    10
  );

  // Updated chunk size to match processWithQueues
  let CHUNK_SIZE = parseInt(config.FETCH_CHUNK_SIZE || "20000", 10);

  // Log initial configuration to both console and file
  const initialConfigMessage = `[Job ${jobId}] Initial configuration: HORIZONTAL_BATCH_SIZE=${HORIZONTAL_BATCH_SIZE}, VERTICAL_BATCH_SIZE=${VERTICAL_BATCH_SIZE}, QUEUE_RATE_LIMIT=${QUEUE_RATE_LIMIT}, QUEUE_MIN_DELAY=${QUEUE_MIN_DELAY}, QUEUE_CONCURRENT_ITEMS=${QUEUE_CONCURRENT_ITEMS}`;
  console.log(initialConfigMessage);
  writeToLogFile(CONFIG_LOG_FILE, initialConfigMessage);

  // Log database configuration values directly
  await verifyDatabaseConfiguration(jobId);

  // Setup configuration change listener
  const handleConfigChanges = (changes: ConfigChangeEvent[]): void => {
    const relevantChanges = changes.filter((change) =>
      [
        "HORIZONTAL_BATCH_SIZE",
        "VERTICAL_BATCH_SIZE",
        "QUEUE_RATE_LIMIT",
        "QUEUE_MIN_DELAY",
        "QUEUE_CONCURRENT_ITEMS",
        "FETCH_CHUNK_SIZE",
      ].includes(change.key)
    );

    if (relevantChanges.length === 0) return;

    // Store previous values for logging
    const previousConfig = {
      HORIZONTAL_BATCH_SIZE,
      VERTICAL_BATCH_SIZE,
      QUEUE_RATE_LIMIT,
      QUEUE_MIN_DELAY,
      QUEUE_CONCURRENT_ITEMS,
      CHUNK_SIZE,
    };

    // Update local configuration values
    relevantChanges.forEach((change) => {
      switch (change.key) {
        case "HORIZONTAL_BATCH_SIZE":
          HORIZONTAL_BATCH_SIZE = Number(change.newValue);
          break;
        case "VERTICAL_BATCH_SIZE":
          VERTICAL_BATCH_SIZE = Number(change.newValue);
          break;
        case "QUEUE_RATE_LIMIT":
          QUEUE_RATE_LIMIT = Number(change.newValue);
          break;
        case "QUEUE_MIN_DELAY":
          QUEUE_MIN_DELAY = Number(change.newValue);
          break;
        case "QUEUE_CONCURRENT_ITEMS":
          QUEUE_CONCURRENT_ITEMS = Number(change.newValue);
          break;
        case "FETCH_CHUNK_SIZE":
          CHUNK_SIZE = Number(change.newValue);
          break;
      }
    });

    // Log configuration changes
    const configChangedMessage = `[Job ${jobId}] CONFIGURATION CHANGED: 
      HORIZONTAL_BATCH_SIZE=${HORIZONTAL_BATCH_SIZE} (was ${previousConfig.HORIZONTAL_BATCH_SIZE}), 
      VERTICAL_BATCH_SIZE=${VERTICAL_BATCH_SIZE} (was ${previousConfig.VERTICAL_BATCH_SIZE}), 
      QUEUE_RATE_LIMIT=${QUEUE_RATE_LIMIT} (was ${previousConfig.QUEUE_RATE_LIMIT}), 
      QUEUE_MIN_DELAY=${QUEUE_MIN_DELAY} (was ${previousConfig.QUEUE_MIN_DELAY}), 
      QUEUE_CONCURRENT_ITEMS=${QUEUE_CONCURRENT_ITEMS} (was ${previousConfig.QUEUE_CONCURRENT_ITEMS}), 
      CHUNK_SIZE=${CHUNK_SIZE} (was ${previousConfig.CHUNK_SIZE})`;

    console.log(configChangedMessage);
    writeToLogFile(CONFIG_LOG_FILE, configChangedMessage);

    // Log current active configuration for reference
    const currentConfigMessage = `[Job ${jobId}] Current active configuration: HORIZONTAL_BATCH_SIZE=${HORIZONTAL_BATCH_SIZE}, VERTICAL_BATCH_SIZE=${VERTICAL_BATCH_SIZE}, QUEUE_RATE_LIMIT=${QUEUE_RATE_LIMIT}, QUEUE_MIN_DELAY=${QUEUE_MIN_DELAY}, QUEUE_CONCURRENT_ITEMS=${QUEUE_CONCURRENT_ITEMS}, CHUNK_SIZE=${CHUNK_SIZE}`;
    writeToLogFile(CONFIG_LOG_FILE, currentConfigMessage);
  };

  // Subscribe to configuration changes
  configService.onConfigChangeBatch(handleConfigChanges);

  /**
   * Utility function to verify the current configuration values in the database
   */
  async function verifyDatabaseConfiguration(jobId: string): Promise<void> {
    try {
      // Define interface for database row
      interface ConfigRow {
        ConfigKey: string;
        ConfigValue: string;
      }

      // Get direct database values
      const result = await DatabaseService.executeQuery(`
      SELECT ConfigKey, ConfigValue FROM PrioritySystemConfig
      WHERE ConfigKey IN ('HORIZONTAL_BATCH_SIZE', 'VERTICAL_BATCH_SIZE', 'QUEUE_RATE_LIMIT', 'QUEUE_MIN_DELAY', 'QUEUE_CONCURRENT_ITEMS', 'FETCH_CHUNK_SIZE')
    `);

      writeToLogFile(
        CONFIG_LOG_FILE,
        `[Job ${jobId}] Direct database configuration values:`
      );

      if (result && Array.isArray(result)) {
        // Type cast the result to the known structure
        (result as ConfigRow[]).forEach((row) => {
          writeToLogFile(
            CONFIG_LOG_FILE,
            `[Job ${jobId}] - ${row.ConfigKey}: ${row.ConfigValue}`
          );
        });
      } else {
        writeToLogFile(
          CONFIG_LOG_FILE,
          `[Job ${jobId}] No configuration values found in database`
        );
      }
    } catch (error) {
      const errorMessage = `[Job ${jobId}] Error verifying database configuration: ${error instanceof Error ? error.message : String(error)}`;
      console.error(errorMessage);
      writeToLogFile(CONFIG_LOG_FILE, errorMessage);
    }
  }

  // Initialize progress tracking
  ProgressTracker.initJob(jobId, totalRecords, jobType);
  const overallPerformance = new PerformanceMonitor();
  overallPerformance.startOperation();

  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results: BatchResult[] = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;

  const childTableNames = childJobs.map((job) => job.DBTableName);

  try {
    while (processedCount < totalRecords) {
      // Check for cancellation before processing each chunk
      if (JobCancellationService.isCancellationRequested(jobId)) {
        const cancelMessage = `Job ${jobId} cancelled - stopping queue processing`;
        console.log(cancelMessage);
        writeToLogFile(CONFIG_LOG_FILE, cancelMessage);
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
        customWhereClause,
        caseId
      );
      perfMonitor.endDbFetch();

      if (rows.length === 0) break;

      // Log configuration before each main processing chunk
      const chunkConfigMessage = `[Job ${jobId}] Processing chunk of ${rows.length} records with configuration: HORIZONTAL_BATCH_SIZE=${HORIZONTAL_BATCH_SIZE}, VERTICAL_BATCH_SIZE=${VERTICAL_BATCH_SIZE}, QUEUE_CONCURRENT_ITEMS=${QUEUE_CONCURRENT_ITEMS}`;
      writeToLogFile(CONFIG_LOG_FILE, chunkConfigMessage);

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

        // Create queue processors for horizontal batches
        const horizontalQueues: QueueProcessor[] = [];
        for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
          const queue = new QueueProcessor(
            `queue-${h}`,
            jobId,
            jobType,
            parentTableName
          );

          // Apply current dynamic settings to queue
          queue.setRateLimitEnabled(true);
          queue.setUpdateBatchTable(updateBatchTable);
          queue.setConcurrency(QUEUE_CONCURRENT_ITEMS);
          queue.setRateLimit(QUEUE_RATE_LIMIT);
          queue.setMinDelay(QUEUE_MIN_DELAY);

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

              ProgressTracker.updateProgress(
                jobId,
                processedCount,
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
          processedCount,
          totalSuccessCount,
          totalFailureCount
        );
      }

      // Update the last processed row ID for the next chunk
      if (rows.length > 0) {
        lastRowId = Math.max(...rows.map((row) => row.RowId));
      }

      processedCount += rows.length;

      ProgressTracker.updateProgress(
        jobId,
        processedCount, // ערך ישיר ללא כפילות
        totalSuccessCount,
        totalFailureCount
      );

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

    const completionMessage = `Parent-child grid job completed: ${processedCount} records (${totalSuccessCount} success, ${totalFailureCount} failed), duration: ${metrics.totalDuration}`;
    console.log(completionMessage);
    writeToLogFile(CONFIG_LOG_FILE, `[Job ${jobId}] ${completionMessage}`);

    // Unsubscribe from configuration changes before completing
    configService.offConfigChangeBatch(handleConfigChanges);

    // Return only the summary of results for each queue
    return results.map((result) => ({
      success: result.success,
      successCount: result.successCount || 0,
      failureCount: result.failureCount || 0,
      rowsCount: result.totalProcessed || 0,
      duration: result.duration,
    }));
  } catch (error) {
    const errorMessage = `Fatal error in processParentChildWithQueues: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage);
    writeToLogFile(CONFIG_LOG_FILE, `[Job ${jobId}] ${errorMessage}`);

    // Unsubscribe from configuration changes even on error
    configService.offConfigChangeBatch(handleConfigChanges);

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
    await DatabaseService.performBulkUpdateWithService(tableName, [
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
 * Utility function to check or update configuration values during processing
 * Use this to programmatically update config values
 */
export async function updateRuntimeConfig(
  configKey: string,
  configValue: string,
  jobId: string = "manual"
): Promise<boolean> {
  try {
    writeToLogFile(
      CONFIG_LOG_FILE,
      `[Job ${jobId}] Manual config update requested: ${configKey}=${configValue}`
    );

    // Get current value first
    const config = await configService.getConfig(true);
    const currentValue = config[configKey];

    // Update the configuration
    const success = await configService.updateConfig(configKey, configValue);

    if (success) {
      writeToLogFile(
        CONFIG_LOG_FILE,
        `[Job ${jobId}] Successfully updated ${configKey} from ${currentValue} to ${configValue}`
      );
      console.log(
        `[Job ${jobId}] Configuration updated: ${configKey}=${configValue} (was ${currentValue})`
      );
    } else {
      writeToLogFile(
        CONFIG_LOG_FILE,
        `[Job ${jobId}] Failed to update ${configKey}`
      );
    }

    return success;
  } catch (error) {
    const errorMessage = `Error updating config ${configKey}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage);
    writeToLogFile(CONFIG_LOG_FILE, `[Job ${jobId}] ${errorMessage}`);
    return false;
  }
}
