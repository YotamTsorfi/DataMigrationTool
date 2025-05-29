import { v4 as uuidv4 } from "uuid";
// import { DatabaseService } from "../services/databaseService";
import { fetchParentChildChunk } from "../services/parentChildChunkFetcher";
import { configService } from "../config/configService";
import PerformanceMonitor from "../utils/performanceMonitor";
import ProgressTracker from "../utils/progressTracker";
import { ErrorBufferService } from "../utils/errorBufferService";
import { JobCancellationService } from "../utils/jobCancellationService";
import { ChildJob } from "./jobParentAndChilds";
import { sendParentChildBatch } from "../services/priorityParentChildSender";
import { performBulkUpdateWithService } from "../services/dataService";
import { QueueProcessor, QueueItem } from "../services/queueProcessor";
// import pLimit from "p-limit";

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
 * Process parent-child records using grid-based processing
 * Horizontal parallelism (multiple queues) with vertical processing (sequential within queue)
 */
export async function processParentChildGridBatches(
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
  updateBatchTable: boolean = false
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

  // Configure error buffer service for efficient error handling
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: 1000,
    minFlushSize: 200,
    flushInterval: 30000,
  });
  errorBuffer.setLoggingEnabled(logErrors);

  // Set grid processing parameters from configuration
  const HORIZONTAL_BATCH_SIZE = parseInt(
    config.HORIZONTAL_BATCH_SIZE || "8",
    10
  );
  const VERTICAL_BATCH_SIZE = parseInt(config.VERTICAL_BATCH_SIZE || "100", 10);
  const CHUNK_SIZE = 2000; // Number of rows to fetch in each database call

  // Initialize progress tracking
  ProgressTracker.initJob(jobId, totalRecords);
  const overallPerformance = new PerformanceMonitor();
  overallPerformance.startOperation();

  // Process in chunks
  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results: BatchResult[] = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;

  // Prepare child table names for response processor
  const childTableNames = childJobs.map((job) => job.DBTableName);

  try {
    while (processedCount < totalRecords) {
      // Check for cancellation before processing each chunk
      if (JobCancellationService.isCancellationRequested(jobId)) {
        console.log(`Job ${jobId} cancelled - stopping grid processing`);
        break; // Exit the processing loop
      }

      const chunkSize = Math.min(CHUNK_SIZE, totalRecords - processedCount);

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
        perfMonitor
      );
      perfMonitor.endDbFetch();

      if (rows.length === 0) break;

      // Create grid-based processing structure
      // Horizontal: multiple queues running in parallel
      // Vertical: each queue processes its own records sequentially
      const horizontalQueues: QueueProcessor[] = [];
      for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
        horizontalQueues.push(
          new QueueProcessor(`queue-${h}`, jobId, jobType, parentTableName)
        );
      }

      // Track workload distribution for load balancing
      const queueWorkloads = new Map<number, number>();
      for (let q = 0; q < horizontalQueues.length; q++) {
        queueWorkloads.set(q, 0);
      }

      // Divide rows into vertical batches and distribute to horizontal queues
      for (let i = 0; i < Math.ceil(rows.length / VERTICAL_BATCH_SIZE); i++) {
        const startIndex = i * VERTICAL_BATCH_SIZE;
        const verticalBatch = rows.slice(
          startIndex,
          startIndex + VERTICAL_BATCH_SIZE
        );

        if (verticalBatch.length === 0) continue;

        // Find the queue with the least workload for load balancing
        let targetQueueIndex = 0;
        let minWorkload = Number.MAX_SAFE_INTEGER;

        for (let q = 0; q < horizontalQueues.length; q++) {
          const workload = queueWorkloads.get(q) || 0;
          if (workload < minWorkload) {
            minWorkload = workload;
            targetQueueIndex = q;
          }
        }

        // Create queue items for the batch
        const batchId = uuidv4();
        const queueItems: QueueItem[] = verticalBatch.map((row) => ({
          row,
          index: processedCount + startIndex + verticalBatch.indexOf(row),
          queueId: `queue-${targetQueueIndex}`,
          jobId,
          batchId,
          jobType,
          tableName: parentTableName,
          priorityScreenName: parentScreenName,
          priorityIdField: parentIdField,
          childJobs,
          childTableNames,
        }));

        // Add items to the selected queue
        horizontalQueues[targetQueueIndex].addItems(queueItems);

        // Update workload tracking
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

      // Process all queues in parallel
      const queuePromises = horizontalQueues
        .filter((q) => q.hasItems())
        .map((queue) => {
          // Check for job cancellation
          if (JobCancellationService.isCancellationRequested(jobId)) {
            return Promise.resolve({
              success: false,
              totalProcessed: 0,
              successCount: 0,
              failureCount: 0,
              duration: 0,
            });
          }

          // Add progress listener to each queue
          const queueId = queue.getQueueId();
          queue.setProgressListener((success, failure) => {
            progressUpdates.set(queueId, { success, failure });

            // Calculate total progress across all queues
            let currentSuccess = 0;
            let currentFailure = 0;

            progressUpdates.forEach((update) => {
              currentSuccess += update.success;
              currentFailure += update.failure;
            });

            // Update overall job progress
            ProgressTracker.updateProgress(
              jobId,
              processedCount + currentSuccess + currentFailure,
              totalSuccessCount + currentSuccess,
              totalFailureCount + currentFailure
            );
          });

          // Override the processItem method for parent-child specific processing
          queue.setItemProcessor(async (item: QueueItem) => {
            try {
              // Create batch object for parent-child processing
              const result = await sendParentChildBatch(
                [item.row],
                jobType,
                parentTableName,
                parentScreenName,
                jobId,
                parentIdField,
                childTableNames,
                childJobs,
                logErrors,
                updateBatchTable
              );
              // Verify success based on detailed result inspection
              const isSuccessful =
                result.success &&
                (result.successCount || 0) > 0 &&
                (result.failureCount || 0) === 0;

              // Log failures when detected
              if (!isSuccessful || result.failureCount) {
                console.warn(
                  `Item ${item.row.RowId} processing reported failures: ${result.failureCount}`
                );
                console.warn(
                  `Error details: ${result.error || "No detailed error provided"}`
                );
              }

              return {
                success: isSuccessful, // Only mark as successful if no failures
                error: result.error,
                responseStats: {
                  successCount: result.successCount || 0,
                  failureCount: result.failureCount || 0,
                },
              };
            } catch (error) {
              console.error(
                `Error processing item in parent-child grid:`,
                error
              );

              // Update database with error state
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

          // Process the queue
          return queue.process();
        });

      // Wait for all queues to complete processing
      const queueResults = await Promise.all(queuePromises);

      // Process results from all queues
      for (let qIndex = 0; qIndex < queueResults.length; qIndex++) {
        const result = queueResults[qIndex];
        results.push(result);

        totalSuccessCount += result.successCount;
        totalFailureCount += result.failureCount;
      }

      // Clear progress updates
      progressUpdates.clear();

      // Update progress
      ProgressTracker.updateProgress(
        jobId,
        processedCount + totalSuccessCount + totalFailureCount,
        totalSuccessCount,
        totalFailureCount
      );

      // Update processed count and last row ID
      if (rows.length > 0) {
        lastRowId = Math.max(...rows.map((row) => row.RowId));
      }
      processedCount += rows.length;

      // Flush errors regularly
      if (totalFailureCount > 0 && totalFailureCount % 500 === 0) {
        await errorBuffer.flush();
      }

      // Help garbage collector
      rows.length = 0;
    }

    // Final flush of any remaining errors
    await errorBuffer.flushAll();

    // Complete progress tracking
    ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

    // Finish performance monitoring
    overallPerformance.endOperation();
    const metrics = overallPerformance.getFormattedMetrics();

    console.log(
      `Parent-child grid job completed: ${processedCount} records (${totalSuccessCount} success, ${totalFailureCount} failed), duration: ${metrics.totalDuration}`
    );

    // Return results summary
    return results.map((result) => ({
      success: result.success,
      successCount: result.successCount || 0,
      failureCount: result.failureCount || 0,
      rowsCount: result.totalProcessed || 0,
      duration: result.duration,
    }));
  } catch (error) {
    console.error(`Fatal error in processParentChildGridBatches:`, error);

    // Ensure errors are flushed even during failure
    await errorBuffer.flushAll();

    // Mark job as complete with failure statistics
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
    // Prepare update row for parent record
    const updateRow = {
      RowId: record.RowId,
      BatchId: batchId,
      JobName: jobType,
      Status: "Failed",
      Error: error instanceof Error ? error.message : String(error), // Add Error field
      JobId: jobId,
      priority_id: null,
      is_new: 1,
    };

    // Prepare error log entry
    const errorRow = {
      JobName: jobType,
      BatchId: batchId,
      TableName: tableName,
      RowId: record.RowId,
      Error: error instanceof Error ? error.message : String(error),
      JobId: jobId,
    };

    // Update database with error status
    await performBulkUpdateWithService(tableName, [updateRow]);

    // Add error to buffer
    ErrorBufferService.getInstance().addErrors([errorRow]);

    // Update child records if present
    if (record.childRecords) {
      const childUpdatesByTable: { [tableName: string]: any[] } = {};

      // Process all child record types
      Object.entries<any[]>(record.childRecords).forEach(
        ([jobType, childRecords]) => {
          if (!Array.isArray(childRecords) || childRecords.length === 0) return;

          const childTableName = childRecords[0]?.__tableName;
          if (!childTableName) return;

          // Initialize array for this table if needed
          if (!childUpdatesByTable[childTableName]) {
            childUpdatesByTable[childTableName] = [];
          }

          // Add each child record update
          childRecords.forEach((child) => {
            childUpdatesByTable[childTableName].push({
              RowId: child.RowId,
              BatchId: batchId,
              JobName: jobType,
              Status: "Failed",
              Error: error instanceof Error ? error.message : String(error),
              JobId: jobId,
              priority_id: null,
              is_new: 1,
            });
          });
        }
      );

      // Update each child table
      for (const [tableName, updates] of Object.entries(childUpdatesByTable)) {
        if (updates.length > 0) {
          await performBulkUpdateWithService(tableName, updates);
        }
      }
    }
  } catch (dbError) {
    console.error(`Failed to update database with error information:`, dbError);
  }
}

/**
 * Helper function to get batch size from configuration
 */
// async function getBatchSize(): Promise<number> {
//   try {
//     const result = await DatabaseService.executeQuery(
//       `SELECT ConfigValue FROM PrioritySystemConfig WHERE ConfigKey = 'BATCH_SIZE'`
//     );

//     return result && result[0]
//       ? parseInt((result[0] as { ConfigValue: string }).ConfigValue, 10)
//       : 1000; // Default batch size
//   } catch (error) {
//     console.error("Error fetching batch size:", error);
//     return 1000; // Default batch size if we can't get the config
//   }
// }

/**
 * Format time for logging
 */
// function formatTime(minutes: number): string {
//   const hrs = Math.floor(minutes / 60);
//   const mins = Math.floor(minutes % 60);
//   return `${hrs}h ${mins}m`;
// }
