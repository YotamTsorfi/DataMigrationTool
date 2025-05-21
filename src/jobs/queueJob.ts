import { v4 as uuidv4 } from "uuid";
import { fetchDataChunk } from "../services/dataService";
import { configService } from "../config/configService";
import PerformanceMonitor from "../utils/performanceMonitor";
import ProgressTracker from "../utils/progressTracker";
import { QueueProcessor, QueueItem } from "../services/queueProcessor";
import {
  performBulkUpdateWithService,
  // performBulkErrorInsertWithService,
} from "../services/dataService";
import { ErrorBufferService } from "../utils/errorBufferService";
import { DatabaseService } from "../services/databaseService";

/**
 * Process records using grid-based processing (horizontal parallel, vertical sequential)
 */
export async function processWithQueues(
  recordCount: number,
  startRow: number,
  tableName: string,
  priorityScreenName: string,
  jobType: string,
  jobId: string,
  priorityIdField?: string,
  logErrors: boolean = false
): Promise<any[]> {
  // Get system configuration
  const config = await configService.getConfig();

  // Initialize ErrorBufferService at the beginning of the function
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: 1000, // Configure a larger flush size
    minFlushSize: 200, // Minimum size before flushing
    flushInterval: 30000, // 30 seconds
  });

  // Set horizontal batch size from configuration or use default
  const HORIZONTAL_BATCH_SIZE = parseInt(
    config.HORIZONTAL_BATCH_SIZE || "10",
    10
  );
  // Set vertical batch size from configuration or use default
  const VERTICAL_BATCH_SIZE = parseInt(config.VERTICAL_BATCH_SIZE || "5", 10);

  // Set chunk size for processing
  // This is the number of rows to process in each database fetch operation
  const CHUNK_SIZE = 1000;

  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount);

  // Process in chunks
  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  let totalProcessedRecords = 0;

  while (processedCount < recordCount) {
    const chunkSize = Math.min(CHUNK_SIZE, recordCount - processedCount);

    // Fetch data chunk from database
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();
    const rows = await fetchDataChunk(tableName, lastRowId, chunkSize);
    perfMonitor.endDbFetch();

    if (rows.length === 0) break;

    // Divide the rows into horizontal and vertical batches
    for (
      let i = 0;
      i < rows.length;
      i += HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE
    ) {
      const horizontalBatch = rows.slice(
        i,
        i + HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE
      );

      // Create queue processors for horizontal batches by the number of horizontal batches
      const horizontalQueues: QueueProcessor[] = [];
      for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
        horizontalQueues.push(
          new QueueProcessor(`queue-${h}`, jobId, jobType, tableName)
        );
      }

      // Divide the horizontal batch into vertical batches
      for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
        const startIndex = h * VERTICAL_BATCH_SIZE;
        const verticalBatch = horizontalBatch.slice(
          startIndex,
          startIndex + VERTICAL_BATCH_SIZE
        );

        if (verticalBatch.length === 0) continue;

        // Add all rows from the vertical batch to the appropriate queue
        const queueItems: QueueItem[] = verticalBatch.map((row, vIndex) => {
          const batchId = uuidv4();

          return {
            row: row,
            index: i + startIndex + vIndex + processedCount,
            queueId: `queue-${h}`,
            jobId,
            batchId,
            jobType,
            tableName,
            priorityScreenName,
            priorityIdField,
          };
        });

        horizontalQueues[h].addItems(queueItems);
      }

      //
      const progressUpdates = new Map();

      // Process each queue in parallel - each queue processes its vertical batch in order
      const queuePromises = horizontalQueues
        .filter((q) => q.hasItems()) // Just process queues with items
        .map((queue) => {
          // **שינוי 2**: הוספת מאזין התקדמות לכל תור
          const queueId = queue.getQueueId();

          // פונקציה שתקרא בכל פעם שתור מעדכן את ההתקדמות שלו
          const updateListener = (success: number, failure: number) => {
            progressUpdates.set(queueId, { success, failure });

            // חישוב סך הכל מכל התורים
            let currentSuccess = 0;
            let currentFailure = 0;

            progressUpdates.forEach((update) => {
              currentSuccess += update.success;
              currentFailure += update.failure;
            });

            // עדכון המעקב הכללי - מוסיפים למספרים המצטברים הכוללים
            ProgressTracker.updateProgress(
              jobId,
              totalProcessedRecords + currentSuccess + currentFailure,
              totalSuccessCount + currentSuccess,
              totalFailureCount + currentFailure
            );
          };

          // הוספת המאזין לתור
          queue.setProgressListener(updateListener);

          // עיבוד התור כרגיל
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
    // This is optional, since the ErrorBufferService will flush based on size/time
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
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    // Check if required fields are present in update rows
    resultData.updateRows.forEach((row, index) => {
      if (!row.RowId || !row.Status || !row.BatchId || !row.JobId) {
        console.warn(`Row at index ${index} is missing required fields:`, row);
      }
    });

    // Check table structure to determine available columns
    const tableColumns = await DatabaseService.executeQuery(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = '${tableName}'
    `);

    // Create a map of column names for easy lookup
    const availableColumns = new Set();
    tableColumns.forEach((col: any) => {
      availableColumns.add(col.COLUMN_NAME);
    });

    // Check if error message column exists and get its name
    const errorColumn = availableColumns.has("ErrorMessage")
      ? "ErrorMessage"
      : availableColumns.has("Error")
        ? "Error"
        : null;

    if (!errorColumn) {
      console.warn(
        `No error column found in table ${tableName}, error details may be lost`
      );
    }

    // For update rows, process possible error message truncation
    resultData.updateRows.forEach((row) => {
      // Truncate error messages if necessary
      if (row.ErrorMessage && row.ErrorMessage.length > 3800) {
        row.ErrorMessage = row.ErrorMessage.substring(0, 3800);
      }
    });

    // Perform bulk update with service - this is a placeholder for the actual service call
    await performBulkUpdateWithService(
      tableName,
      resultData.updateRows,
      perfMonitor,
      1000, // Batch size for bulk update
      3, //  Maximum number of retries
      true // Sent to Priority screen
    );

    // console.log(`Successfully updated ${resultData.updateRows.length} rows in ${tableName}`);
  } catch (error) {
    console.error(`Error updating rows in ${tableName}:`, error);

    // This is a fallback mechanism to ensure that we try to update each row individually
    console.log(`Trying to update rows individually`);
    for (const row of resultData.updateRows) {
      try {
        // Check table structure to determine available columns
        const tableColumns = await DatabaseService.executeQuery(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = '${tableName}'
        `);

        // Create a map of column names for easy lookup
        const availableColumns = new Set();
        tableColumns.forEach((col: any) => {
          availableColumns.add(col.COLUMN_NAME);
        });

        // Check if error column exists and get its name
        const errorColumn = availableColumns.has("ErrorMessage")
          ? "ErrorMessage"
          : availableColumns.has("Error")
            ? "Error"
            : null;

        // Check if table has priority_id column
        const hasPriorityId = availableColumns.has("priority_id");

        let query = `
          UPDATE ${tableName}
          SET Status = @Status, 
              BatchId = @BatchId, 
              JobName = @JobName`;

        if (errorColumn) {
          query += `, ${errorColumn} = @ErrorValue`;
        }

        // Add priority_id to update if the column exists and we have a value
        if (hasPriorityId && row.priority_id != null) {
          query += `, priority_id = @PriorityId`;
        }

        query += ` WHERE RowId = @RowId`;

        const params: any = {
          Status: row.Status,
          BatchId: row.BatchId,
          JobName: row.JobName,
          RowId: row.RowId,
        };

        if (errorColumn) {
          // Truncate error message if needed
          const errorValue = row.ErrorMessage || row.Error || null;
          params.ErrorValue =
            errorValue && errorValue.length > 3800
              ? errorValue.substring(0, 3800)
              : errorValue;
        }

        // Add priority_id parameter if the column exists and we have a value
        if (hasPriorityId && row.priority_id != null) {
          params.PriorityId = row.priority_id;
        }

        await DatabaseService.executeQuery(query, params);
      } catch (innerError) {
        console.error(`Failed to update row ${row.RowId}:`, innerError);
      }
    }
  }

  // Insert error logs
  if (resultData.errorRows.length > 0 && logErrors) {
    try {
      ErrorBufferService.getInstance().addErrors(resultData.errorRows);
      // await performBulkErrorInsertWithService(
      //   resultData.errorRows,
      //   perfMonitor
      // );
    } catch (error) {
      console.error("Error inserting error logs for queue results:", error);
    }
  }

  perfMonitor.endOperation();
  // const metrics = perfMonitor.getFormattedMetrics();
  // console.log(`Queue results processing completed in ${metrics.totalDuration}ms`);
}
