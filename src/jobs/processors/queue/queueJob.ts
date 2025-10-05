import { v4 as uuidv4 } from "uuid";
import PerformanceMonitor from "../../../utils/performanceMonitor";
import ProgressTracker from "../../../utils/progressTracker";
import { ErrorBufferService } from "../../../utils/errorBufferService";
import { JobCancellationService } from "../../../utils/jobCancellationService";
import { configService } from "../../../config/configService";
import { DatabaseService } from "../../../services/database/databaseService";
import { fetchDataChunk } from "../../../services/database/dataService";
import { QueueProcessor } from "../../../services/processing/queue/queueProcessor";
import { QueueItem } from "../../../types/jobTypes";

/**
 * Process records using grid-based processing (horizontal parallel, vertical sequential)
 * with support for delta processing
 */
export async function processWithQueues(
  recordCount: number,
  startRow: number,
  tableName: string,
  priorityScreenName: string,
  jobType: string,
  jobId: string,
  priorityIdField?: string,
  logErrors: boolean = false,
  updateBatchTable: boolean = false,
  customWhereClause?: string,
  caseId?: string
): Promise<any[]> {
  // Get system configuration
  const config = await configService.getConfig();

  // Determine if this is a delta job
  const isDelta = jobType.toLowerCase().includes("delta");
  const isChildDelta = isDelta && jobType.toLowerCase().includes("child");

  let parentTableName: string | undefined;

  // If this is a child delta job, get the parent table name
  if (isChildDelta) {
    try {
      interface JobTypeInfo {
        dbParentTableName: string;
      }

      const jobTypeInfo = await DatabaseService.executeQuery<JobTypeInfo>(
        `SELECT dbParentTableName FROM PriorityJobTypes WHERE JobTypeName = @jobTypeName`,
        { jobTypeName: jobType }
      );

      if (jobTypeInfo && jobTypeInfo.length > 0) {
        parentTableName = jobTypeInfo[0].dbParentTableName;
        console.log(
          `Child delta job ${jobType} detected. Parent table: ${parentTableName}`
        );
      }
    } catch (error) {
      console.error(
        `Error fetching parent table for child delta job ${jobType}:`,
        error
      );
    }
  }

  console.log(
    `Processing ${isDelta ? "DELTA" : "standard"} job ${jobType}${isChildDelta ? " (CHILD)" : ""}`
  );

  // Initialize ErrorBufferService at the beginning of the function
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: 2000, // Configure a larger flush size
    minFlushSize: 500, // Minimum size before flushing
    flushInterval: 120000, // 2 minutes
  });

  // Set horizontal batch size from configuration or use default
  const HORIZONTAL_BATCH_SIZE = parseInt(
    config.HORIZONTAL_BATCH_SIZE || "40",
    10
  );
  // Set vertical batch size from configuration or use default
  const VERTICAL_BATCH_SIZE = parseInt(
    config.VERTICAL_BATCH_SIZE || "1000",
    10
  );

  // Set chunk size for processing - now dynamic from database config
  const CHUNK_SIZE = parseInt(config.FETCH_CHUNK_SIZE || "20000", 10);

  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount, jobType);

  // Process in chunks
  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  let totalProcessedRecords = 0;

  while (processedCount < recordCount) {
    // Check for cancellation before processing each chunk
    if (JobCancellationService.isCancellationRequested(jobId)) {
      console.log(`Job ${jobId} cancelled - stopping queue processing`);
      break; // Exit the processing loop
    }

    const chunkSize = Math.min(CHUNK_SIZE, recordCount - processedCount);

    // Get custom WHERE clause from config if not provided directly
    if (!customWhereClause) {
      const clause = await configService.getWhereClauseForJobType(jobType);
      customWhereClause = clause === null ? undefined : clause;
    }

    // Fetch data chunk from database with delta support
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();
    const rows = await fetchDataChunk(
      tableName,
      lastRowId,
      chunkSize,
      customWhereClause,
      caseId,
      isDelta,
      isChildDelta,
      parentTableName
    );
    perfMonitor.endDbFetch();

    if (rows.length === 0) break;

    // Divide the rows into horizontal and vertical batches
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
          tableName
        );
        queue.setUpdateBatchTable(updateBatchTable);
        queue.setDeltaMode(isDelta, isChildDelta);
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

          // For child delta records that need parent priority ID, format it properly
          if (
            isDelta &&
            isChildDelta &&
            row.__deltaMetadata &&
            row.__deltaMetadata.parent_priority_id &&
            row.__deltaMetadata.delta_action === 1
          ) {
            row.__deltaMetadata.parent_priority_id += `/${priorityScreenName}_SUBFORM`;
          }

          return {
            row: row,
            index: i + startIndex + vIndex + processedCount,
            queueId: `queue-${targetQueueIndex}`,
            jobId,
            batchId,
            jobType,
            tableName,
            priorityScreenName,
            priorityIdField,
            isDelta,
            isChildDelta,
            deltaMetadata: row.__deltaMetadata,
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

      const progressUpdates = new Map();

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

          // Get the queue ID for progress tracking
          const queueId = queue.getQueueId();

          // Initialize progress tracking for this queue
          const updateListener = (success: number, failure: number) => {
            progressUpdates.set(queueId, { success, failure });

            // Update the total success and failure counts
            let currentSuccess = 0;
            let currentFailure = 0;

            progressUpdates.forEach((update) => {
              currentSuccess += update.success;
              currentFailure += update.failure;
            });

            // Update the progress tracker with the total counts
            ProgressTracker.updateProgress(
              jobId,
              totalProcessedRecords + currentSuccess + currentFailure,
              totalSuccessCount + currentSuccess,
              totalFailureCount + currentFailure
            );
          };

          // Set the progress listener for this queue
          queue.setProgressListener(updateListener);

          /*
           * Each queue processes its items sequentially to maintain order within the queue.
           * However, all queues run in parallel to maximize throughput.
           */
          // Process the queue and return the result
          return queue.process();
        });

      const queueResults = await Promise.all(queuePromises);

      // Aggregate results from all queues
      for (let qIndex = 0; qIndex < queueResults.length; qIndex++) {
        const result = queueResults[qIndex];
        results.push(result);
        totalSuccessCount += result.successCount;
        totalFailureCount += result.failureCount;

        // Get the result data for this queue to update the database
        const resultData = horizontalQueues[qIndex].getResultData();
        // Update the database with the results
        await processQueueResults(resultData, tableName, logErrors);
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
    lastRowId = (rows[rows.length - 1] as { RowId: number }).RowId;
    processedCount += rows.length;
    totalProcessedRecords = processedCount;

    // Ensure we're flushing errors regularly
    if (totalFailureCount > 0 && totalFailureCount % 500 === 0) {
      await errorBuffer.flush();
    }
  }

  // Make sure to flush any remaining errors before completing
  await errorBuffer.flushAll();

  // Finalize progress tracking for this job
  ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

  // Return only the summary of results for each queue
  return results.map((result) => ({
    success: result.success,
    totalProcessed: result.totalProcessed,
    successCount: result.successCount,
    failureCount: result.failureCount,
    duration: result.duration,
  }));
}

// Process queue results by updating the database and inserting error logs
async function processQueueResults(
  resultData: {
    updateRows: any[];
    errorRows: any[];
    successCount: number;
    failureCount: number;
    lastProcessedIndex: number;
  },
  tableName: string,
  logErrors: boolean
): Promise<void> {
  // Start a performance monitor for metrics
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  // Start database operations in the background but don't wait for them
  await performDatabaseUpdatesAsync(
    resultData,
    tableName,
    logErrors,
    perfMonitor
  );

  // Return immediately without awaiting database operations
  return Promise.resolve();
}

// Background database update function that runs independently
async function performDatabaseUpdatesAsync(
  resultData: {
    updateRows: any[];
    errorRows: any[];
    successCount: number;
    failureCount: number;
    lastProcessedIndex: number;
  },
  tableName: string,
  logErrors: boolean,
  perfMonitor: PerformanceMonitor
): Promise<void> {
  try {
    // Cache table structure
    let tableColumns;
    const availableColumns = new Set();
    let errorColumn: string | null = null;
    let hasPriorityId = false;
    let hasStatusCode = false;

    try {
      // Fetch table structure only once
      tableColumns = await DatabaseService.executeQuery(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName`,
        { tableName }
      );

      // Populate available columns set
      tableColumns.forEach((col: any) => {
        availableColumns.add(col.COLUMN_NAME);
      });

      // Determine the error column based on available columns
      errorColumn = availableColumns.has("ErrorMessage")
        ? "ErrorMessage"
        : availableColumns.has("Error")
          ? "Error"
          : null;

      hasPriorityId = availableColumns.has("priority_id");
      hasStatusCode = availableColumns.has("StatusCode");
    } catch (error) {
      console.error(`Error fetching table structure for ${tableName}:`, error);
      // Default to a reasonable error column if not found
      errorColumn = "ErrorMessage";
    }

    //  if (resultData.updateRows.length === 0 && resultData.errorRows.length === 0) {
    const MAX_BULK_RETRIES = 3;
    let bulkUpdateSuccessful = false;
    let bulkRetryCount = 0;

    // console.log(
    //   `Sending ${resultData.updateRows.length} updates to database (Success: ${resultData.successCount}, Failed: ${resultData.failureCount})`
    // );
    // console.log(
    //   "First few update rows:",
    //   resultData.updateRows.slice(0, 3).map((row) => ({
    //     RowId: row.RowId,
    //     Status: row.Status,
    //     BatchId: row.BatchId,
    //     JobName: row.JobName,
    //     priority_id: row.priority_id,
    //     StatusCode: row.StatusCode,
    //   }))
    // );

    resultData.updateRows.forEach((row) => {
      // Sanitize ErrorMessage
      if (row.ErrorMessage && row.ErrorMessage.length > 3800) {
        row.ErrorMessage = row.ErrorMessage.substring(0, 3800);
      }

      // Generate CleanError field - remove numbers and special characters
      const errorValue = row.ErrorMessage || row.Error || null;
      if (errorValue) {
        // Remove numbers and special characters while preserving Hebrew and English text
        row.CleanError = errorValue
          .replace(/[0-9]/g, "") // Remove all numbers
          .replace(/[^\p{L}\s]/gu, "") // Keep only letters (including Hebrew) and spaces
          .trim();
      } else {
        row.CleanError = null;
      }

      try {
        if (
          row.priority_id === undefined ||
          row.priority_id === null ||
          row.priority_id === "" ||
          typeof row.priority_id !== "string"
        ) {
          // console.log(`RowId ${row.RowId} priority_id:`, {
          //   value: row.priority_id,
          //   type: typeof row.priority_id,
          //   length: row.priority_id?.length ?? 0,
          // });
          row.priority_id = null;
        } else {
          const strValue = String(row.priority_id).trim();
          if (!strValue) {
            row.priority_id = null;
          } else {
            const sanitized = strValue
              .replace(/\p{C}/gu, "")
              // .replace(/[\\"']/g, "")
              .substring(0, 255);
            row.priority_id = sanitized || null;

            if (!sanitized || sanitized.length === 0) {
              row.priority_id = null;
            } else {
              row.priority_id = sanitized;
            }
          }
        }
      } catch (e) {
        console.error(
          `Failed to sanitize priority_id for RowId ${row.RowId}:`,
          e
        );
        row.priority_id = null;
      }
    });

    while (!bulkUpdateSuccessful && bulkRetryCount < MAX_BULK_RETRIES) {
      try {
        await DatabaseService.performBulkUpdateWithService(
          tableName,
          resultData.updateRows,
          perfMonitor,
          1000,
          3,
          true
        );
        bulkUpdateSuccessful = true;
      } catch (error) {
        bulkRetryCount++;
        console.error(
          `Bulk update attempt ${bulkRetryCount}/${MAX_BULK_RETRIES} failed:`,
          error
        );

        if (bulkRetryCount < MAX_BULK_RETRIES) {
          console.log(`Waiting before retry ${bulkRetryCount}...`);
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * bulkRetryCount)
          );
        }
      }
    }

    if (!bulkUpdateSuccessful) {
      console.warn(
        `Bulk update failed after ${MAX_BULK_RETRIES} attempts, trying individual updates...`
      );

      // If bulk update failed, try individual updates
      const successfullyUpdatedRowIds = new Set<number>();

      // Individual update with retries
      for (const row of resultData.updateRows) {
        if (!row.RowId || successfullyUpdatedRowIds.has(row.RowId)) continue;

        const MAX_INDIVIDUAL_RETRIES = 2;
        let individualRetryCount = 0;
        let individualUpdateSuccess = false;

        while (
          !individualUpdateSuccess &&
          individualRetryCount < MAX_INDIVIDUAL_RETRIES
        ) {
          try {
            let query = `
              UPDATE ${tableName}
              SET Status = @Status, 
                  BatchId = @BatchId, 
                  JobName = @JobName`;

            if (errorColumn) {
              query += `, ${errorColumn} = @ErrorValue`;
            }

            if (availableColumns.has("CleanError")) {
              query += `, CleanError = @CleanErrorValue`;
            }

            if (hasPriorityId && row.priority_id != null) {
              query += `, priority_id = @PriorityId`;
            }

            if (hasStatusCode && row.StatusCode != null) {
              query += `, StatusCode = @StatusCode`;
            }
            query += ` WHERE RowId = @RowId`;

            const params: any = {
              Status: row.Status,
              BatchId: row.BatchId,
              JobName: row.JobName,
              RowId: row.RowId,
            };

            if (hasStatusCode && row.StatusCode != null) {
              params.StatusCode = row.StatusCode;
            }

            if (errorColumn) {
              const errorValue = row.ErrorMessage || row.Error || null;
              params.ErrorValue =
                errorValue && errorValue.length > 3800
                  ? errorValue.substring(0, 3800)
                  : errorValue;
            }

            if (availableColumns.has("CleanError")) {
              const errorValue = row.ErrorMessage || row.Error || null;
              params.CleanErrorValue = errorValue
                ? errorValue
                    .replace(/[0-9]/g, "")
                    .replace(/[^\p{L}\s]/gu, "")
                    .trim()
                : null;
            }

            if (hasPriorityId && row.priority_id != null) {
              params.PriorityId = row.priority_id;
            }

            await DatabaseService.executeQuery(query, params);
            individualUpdateSuccess = true;
            successfullyUpdatedRowIds.add(row.RowId);
          } catch (innerError) {
            individualRetryCount++;
            console.error(
              `Individual update attempt ${individualRetryCount}/${MAX_INDIVIDUAL_RETRIES} for row ${row.RowId} failed:`,
              innerError
            );

            if (individualRetryCount < MAX_INDIVIDUAL_RETRIES) {
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * individualRetryCount)
              );
            }
          }
        }

        if (!individualUpdateSuccess) {
          console.error(
            `Failed to update row ${row.RowId} after ${MAX_INDIVIDUAL_RETRIES} attempts`
          );
        }
      }
    }

    // Process error rows if any
    if (resultData.errorRows.length > 0 && logErrors) {
      try {
        ErrorBufferService.getInstance().addErrors(resultData.errorRows);
      } catch (error) {
        console.error("Error buffering error logs:", error);
      }
    }
  } catch (error) {
    console.error("Unhandled error during async database update:", error);
  } finally {
    // Always end the performance monitor operation
    perfMonitor.endOperation();
  }
}
