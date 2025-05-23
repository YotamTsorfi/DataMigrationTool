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
import { JobCancellationService } from "../utils/jobCancellationService";

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
    // Check for cancellation before processing each chunk
    if (JobCancellationService.isCancellationRequested(jobId)) {
      console.log(`Job ${jobId} cancelled - stopping queue processing`);
      break; // Exit the processing loop
    }
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
      // Check for cancellation before processing each horizontal batch
      if (JobCancellationService.isCancellationRequested(jobId)) {
        console.log(`Job ${jobId} cancelled - stopping queue processing`);
        break; // Exit the batch processing loop
      }

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

  // 1. נשמור את מבנה הטבלה בתחילת הפונקציה במקום לשאול שוב ושוב
  let tableColumns;
  const availableColumns = new Set();
  let errorColumn: string | null = null;
  let hasPriorityId = false;

  try {
    // בדיקת מבנה טבלה - פעם אחת בלבד
    tableColumns = await DatabaseService.executeQuery(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tableName`,
      { tableName }
    );

    // יצירת מפת שמות עמודות לחיפוש מהיר
    tableColumns.forEach((col: any) => {
      availableColumns.add(col.COLUMN_NAME);
    });

    // בדיקה אם קיימת עמודת הודעת שגיאה ומה שמה
    errorColumn = availableColumns.has("ErrorMessage")
      ? "ErrorMessage"
      : availableColumns.has("Error")
        ? "Error"
        : null;

    hasPriorityId = availableColumns.has("priority_id");
  } catch (error) {
    console.error(`Error fetching table structure for ${tableName}:`, error);
    // אפילו אם נכשלנו בשליפת מבנה הטבלה, ננסה להמשיך עם ברירות מחדל סבירות
    errorColumn = "ErrorMessage"; // ברירת מחדל סבירה
  }

  // 2. עדכון במסה עם טיפול בשגיאות משופר
  const MAX_BULK_RETRIES = 3;
  let bulkUpdateSuccessful = false;
  let bulkRetryCount = 0;

  // קיצוץ הודעות שגיאה ארוכות מדי
  resultData.updateRows.forEach((row) => {
    // Sanitize ErrorMessage
    if (row.ErrorMessage && row.ErrorMessage.length > 3800) {
      row.ErrorMessage = row.ErrorMessage.substring(0, 3800);
    }

    // Sanitize priority_id - ensure it's always a valid string or null
    if (row.priority_id !== null && row.priority_id !== undefined) {
      try {
        // Ensure it's a valid string
        row.priority_id = String(row.priority_id);

        // Truncate if too long for SQL nvarchar(50)
        if (row.priority_id.length > 50) {
          row.priority_id = row.priority_id.substring(0, 50);
        }
      } catch (e) {
        const errorMsg =
          e && typeof e === "object" && "message" in e
            ? (e as any).message
            : String(e);
        console.warn(
          `Invalid priority_id value for RowId ${row.RowId}: ${errorMsg}`
        );
        row.priority_id = null;
      }
    } else {
      row.priority_id = null; // Explicitly set null for undefined values
    }
  });

  while (!bulkUpdateSuccessful && bulkRetryCount < MAX_BULK_RETRIES) {
    try {
      await performBulkUpdateWithService(
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
        // המתנה הדרגתית בין ניסיונות
        console.log(`Waiting before retry ${bulkRetryCount}...`);
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * bulkRetryCount)
        );
      }
    }
  }

  // 3. אם העדכון במסה נכשל, ננסה עדכונים בודדים עם ניסיונות חוזרים
  if (!bulkUpdateSuccessful) {
    console.warn(
      `Bulk update failed after ${MAX_BULK_RETRIES} attempts, trying individual updates...`
    );

    // שמירת רשימת מזהי השורות שעודכנו בהצלחה כדי למנוע כפילויות
    const successfullyUpdatedRowIds = new Set<number>();

    // עיבוד כל השורות בנפרד
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
            const errorValue = row.ErrorMessage || row.Error || null;
            params.ErrorValue =
              errorValue && errorValue.length > 3800
                ? errorValue.substring(0, 3800)
                : errorValue;
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

  // 4. רישום לוג שגיאות
  if (resultData.errorRows.length > 0 && logErrors) {
    try {
      ErrorBufferService.getInstance().addErrors(resultData.errorRows);
    } catch (error) {
      console.error("Error buffering error logs:", error);
    }
  }

  perfMonitor.endOperation();
}
