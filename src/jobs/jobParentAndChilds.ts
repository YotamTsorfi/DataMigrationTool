import { DatabaseService } from "../services/databaseService";
import { streamParentChildData } from "../services/parentChildDataFetcher";
import { sendParentChildBatch } from "../services/priorityParentChildSender";
import ProgressTracker from "../utils/progressTracker";
import PerformanceMonitor from "../utils/performanceMonitor";
import { performBulkUpdateWithService } from "../services/dataService";
import { ErrorBufferService } from "../utils/errorBufferService";
import { configService } from "../config/configService";
import pLimit from "p-limit";
import { JobCancellationService } from "../utils/jobCancellationService";
// import { writeToLogFile } from "../config/logger";

export interface ChildJob {
  ChildJobeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string;
  HasSiblings: boolean;
}

interface BatchResult {
  success: boolean;
  successCount?: number;
  failureCount?: number;
  error?: any;
}
//---------------------------------------------------------------------------
/**
 * Process parent records with their related child records in batches
 */
async function processParentChildBatches(
  totalRecords: number,
  startRow: number,
  parentTableName: string,
  parentScreenName: string,
  jobType: string,
  jobId: string,
  parentIdField: string,
  linkedField: string,
  childJobs: ChildJob[],
  logErrors: boolean = false
): Promise<BatchResult[]> {
  // Debug logging (keep this)
  console.log("------------- DEBUG --------------------");
  console.log("Parent job details:");
  console.log(`  Table Name: ${parentTableName}`);
  console.log(`  Screen Name: ${parentScreenName}`);
  console.log(`  Parent ID Field: ${parentIdField}`);
  console.log(`  Linked Field: ${linkedField}`);
  console.log(`  Job Type: ${jobType}`);
  console.log("------------");
  console.log("Child jobs details:");
  childJobs.forEach((job, index) => {
    console.log(`Child job ${index + 1}:`);
    console.log(`  JobType: ${job.JobTypeName}`);
    console.log(`  TableName: ${job.DBTableName}`);
    console.log(`  ScreenName: ${job.ScreenName}`);
    console.log(`  Priority ID: ${job.priority_id}`);
    console.log(`  HasSiblings: ${job.HasSiblings}`);
  });
  console.log("---------------END DEBUG ---------------------");

  const lastProgressUpdate = { time: Date.now(), records: 0 };
  const logInterval = 1000; // הדפס לוג רק כל 1000 רשומות
  let lastLogTime = Date.now();
  const logIntervalTime = 30000; // או כל 30 שניות, מה שקורה קודם

  const phaseMetrics = {
    dbFetch: { total: 0, count: 0 },
    apiRequest: { total: 0, count: 0 },
    responseProcessing: { total: 0, count: 0 },
  };

  // Initialize job tracking
  ProgressTracker.initJob(jobId, totalRecords);
  const overallPerformance = new PerformanceMonitor();
  overallPerformance.startOperation();

  const results: BatchResult[] = [];
  const batchSize = await getBatchSize();
  let processedRecords = 0;
  let totalSuccessCount = 0;
  let totalFailureCount = 0;

  // Fixed for exactly 100 records per batch
  const maxBatchSizeForApi = 100;

  // Get concurrency setting from database
  const config = await configService.getConfig();
  const maxConcurrentBatches = config.CONCURRENT_BATCHES;

  // סט מירבי של באצ'ים לשרת (מגבלה יעילה)
  const maxBatchesPerServer = 8;
  const serverCount = 4; // מספר השרתים בלואד-באלאנסר

  // ערך מירבי של מקביליות - לפי כמות השרתים והערך שהוגדר
  const effectiveConcurrency = Math.min(
    maxConcurrentBatches,
    maxBatchesPerServer * serverCount
  );

  console.log(
    `Using concurrency of ${effectiveConcurrency} batches (${serverCount} servers with ${maxBatchesPerServer} batches per server)`
  );

  // יצירת בריכת העובדים המקבילים - לפי הערך האפקטיבי שחישבנו
  const workerPool = pLimit(effectiveConcurrency);

  // רשימת העבודות הפעילות
  const activeJobs = new Set();

  // Configure error buffer for more efficient error logging
  const errorBuffer = ErrorBufferService.getInstance();
  errorBuffer.configure({
    flushSize: 1000,
    minFlushSize: 200,
    flushInterval: 30000,
  });
  // Set the logging state based on the parameter
  errorBuffer.setLoggingEnabled(logErrors);

  // Add error tracking
  let consecutiveFailedBatches = 0;
  const maxConsecutiveFailures = 3;

  // נקודת התחלה ומעקב אחר התקדמות
  let currentRow = 0;
  let currentStartRow = startRow;

  // Prepare child table names for response processor
  const childTableNames = childJobs.map((job) => job.DBTableName);

  // פונקציה לטיפול בסיום באצ'
  const handleBatchCompletion = (promise: Promise<any>) => {
    activeJobs.delete(promise);

    // אם יש עוד רשומות לעיבוד ויש מקום בבריכת העובדים, נמשיך לשלוף ולשלוח
    if (currentRow < totalRecords) {
      fetchAndProcessBatch();
    }
  };

  // פונקציה לשליפה ושליחה של באצ' בודד
  async function fetchAndProcessBatch() {
    // Check for cancellation before processing each batch
    if (JobCancellationService.isCancellationRequested(jobId)) {
      console.log(`Job ${jobId} cancelled - stopping processing`);
      return; // Exit the function
    }
    // אם הגענו לסוף הרשומות, נסיים
    if (currentRow >= totalRecords) return;

    // נשלוף כמות רשומות המתאימה לבאצ' אחד (100 רשומות)
    const batchRemaining = Math.min(
      maxBatchSizeForApi,
      totalRecords - currentRow
    );

    console.log(
      `Fetching next batch at offset ${currentStartRow}, remaining: ${batchRemaining}`
    );

    // 1. התחלת מדידת זמן שליפה
    const fetchMonitor = new PerformanceMonitor();
    fetchMonitor.startDbFetch();

    // 2. יצירת הסטרים ושליפת הנתונים
    const dataStream = streamParentChildData(
      parentTableName,
      batchSize,
      currentStartRow,
      batchRemaining,
      linkedField,
      childJobs
    );

    // 3. עיבוד הסטרים וקריאת הנתונים
    const records: any[] = [];
    let lastRowId = currentStartRow;

    for await (const record of dataStream) {
      if (!record || typeof record !== "object") {
        console.warn(`Skipping invalid record: ${JSON.stringify(record)}`);
        continue;
      }

      // שמירת ה-RowId הגבוה ביותר
      if (record.RowId && record.RowId > lastRowId) {
        lastRowId = record.RowId;
      }

      records.push(record);
      processedRecords++;
      currentRow++;

      // אם הגענו לגודל באצ' מלא, נפסיק את הלולאה
      if (records.length >= maxBatchSizeForApi) break;
    }

    // 4. סיום מדידת זמן שליפה
    fetchMonitor.endDbFetch();
    phaseMetrics.dbFetch.total += fetchMonitor.metrics.dbFetchTime || 0;
    phaseMetrics.dbFetch.count++;

    if (
      processedRecords % logInterval === 0 ||
      Date.now() - lastLogTime > logIntervalTime
    ) {
      console.log(
        `Progress: ${processedRecords}/${totalRecords} (${Math.floor((processedRecords / totalRecords) * 100)}%) | ` +
          `Average fetch: ${(phaseMetrics.dbFetch.total / phaseMetrics.dbFetch.count).toFixed(2)}ms | ` +
          `Average API: ${(phaseMetrics.apiRequest.total / phaseMetrics.apiRequest.count).toFixed(2)}ms | ` +
          `Active batches: ${activeJobs.size}`
      );
      lastLogTime = Date.now();
    }

    // עדכון נקודת ההתחלה לבאצ' הבא
    currentStartRow = lastRowId + 1;

    // אם אין יותר רשומות, נסיים
    if (records.length === 0) {
      console.log(`No more records available at offset ${currentStartRow}`);
      return;
    }

    // 5. שליחת הבאצ' דרך בריכת העובדים
    const sendPromise = workerPool(async () => {
      // 5.1 מדידת זמן שליחה לAPI
      const apiStartTime = performance.now();

      try {
        // 5.2 שליחת הבאצ' לAPI
        const result = await sendParentChildBatch(
          records,
          jobType,
          parentTableName,
          parentScreenName,
          jobId,
          parentIdField,
          childTableNames,
          childJobs,
          logErrors
        );

        // 5.3 מדידת זמן סיום API
        const apiTime = performance.now() - apiStartTime;
        phaseMetrics.apiRequest.total += apiTime;
        phaseMetrics.apiRequest.count++;

        console.log(
          `Batch API request completed in ${apiTime.toFixed(2)}ms for ${records.length} records`
        );

        // 5.4 עיבוד התוצאות ועדכון הסטטיסטיקה
        if (result.performanceMetrics?.dbUpdateTime) {
          const dbUpdateTimeStr = result.performanceMetrics.dbUpdateTime;
          const dbUpdateTime = parseFloat(dbUpdateTimeStr.replace("ms", ""));
          if (!isNaN(dbUpdateTime)) {
            phaseMetrics.responseProcessing.total += dbUpdateTime;
            phaseMetrics.responseProcessing.count++;
          }
        }

        // עדכון סטטיסטיקות הצלחה וכישלון
        totalSuccessCount += result.successCount || 0;
        totalFailureCount += result.failureCount || 0;

        // עדכון מעקב התקדמות
        ProgressTracker.updateProgress(
          jobId,
          totalSuccessCount + totalFailureCount,
          totalSuccessCount,
          totalFailureCount
        );

        // בדיקת כישלונות רצופים
        if (
          (result.failureCount || 0) > 0 &&
          (result.successCount || 0) === 0
        ) {
          consecutiveFailedBatches++;
          console.warn(
            `Batch completely failed (${consecutiveFailedBatches} consecutive failures) - continuing anyway`
          );

          if (consecutiveFailedBatches >= maxConsecutiveFailures) {
            console.warn(
              `${maxConsecutiveFailures}+ consecutive failed batches detected, but continuing per configuration`
            );
          }
        } else {
          // איפוס מונה כישלונות רצופים בהצלחה כלשהי
          consecutiveFailedBatches = 0;
        }

        // הוספת התוצאות למערך הכולל
        results.push({
          success: result.success,
          successCount: result.successCount,
          failureCount: result.failureCount,
          error: result.error,
        });

        return result;
      } catch (error) {
        // 5.5 טיפול בשגיאות
        console.error(`Error processing batch:`, error);
        consecutiveFailedBatches++;

        // עדכוני DB במקרה של שגיאה
        await forceErrorRecordUpdates(records, jobId, error);

        totalFailureCount += records.length;
        ProgressTracker.updateProgress(
          jobId,
          totalSuccessCount + totalFailureCount,
          totalSuccessCount,
          totalFailureCount
        );

        // הוספת שגיאה לתוצאות
        const errorResult = {
          success: false,
          successCount: 0,
          failureCount: records.length,
          error: error instanceof Error ? error.message : String(error),
        };

        results.push(errorResult);
        return errorResult;
      } finally {
        // עזרה ל-garbage collection
        records.length = 0;
      }
    });

    // הוספת הפרומיס למעקב
    activeJobs.add(sendPromise);

    // טיפול בסיום העבודה
    sendPromise
      .then(() => handleBatchCompletion(sendPromise))
      .catch(() => handleBatchCompletion(sendPromise));
  }

  try {
    // התחלת התהליך - אתחול של מספר עבודות בהתאם למקביליות המותרת
    const initialBatches = Math.min(
      effectiveConcurrency,
      Math.ceil(totalRecords / maxBatchSizeForApi)
    );
    console.log(`Initializing ${initialBatches} concurrent batches`);

    for (let i = 0; i < initialBatches; i++) {
      // Check for cancellation before processing each batch
      if (JobCancellationService.isCancellationRequested(jobId)) {
        console.log(`Job ${jobId} cancelled - stopping processing`);
        break; // Exit the processing loop
      }
      if (currentRow < totalRecords) {
        await fetchAndProcessBatch();
      }
    }

    // המתנה לסיום כל העבודות הפעילות
    while (activeJobs.size > 0) {
      // Check for cancellation before processing each batch
      if (JobCancellationService.isCancellationRequested(jobId)) {
        console.log(`Job ${jobId} cancelled - stopping processing`);
        break; // Exit the processing loop
      }

      await Promise.race(Array.from(activeJobs));
      // המשך התהליך אוטומטית דרך handleBatchCompletion

      // לוג התקדמות
      // if (processedRecords % 10000 === 0 || processedRecords >= totalRecords) {
      //   console.log(
      //     `Progress: ${processedRecords}/${totalRecords} records processed (${Math.floor((processedRecords / totalRecords) * 100)}%)`
      //   );
      // }

      // הוסף הצגת קצב עיבוד:
      const now = Date.now();
      const timeDiff = now - lastProgressUpdate.time;
      if (timeDiff > 60000) {
        // כל דקה
        const recordDiff = processedRecords - lastProgressUpdate.records;
        const recordsPerMinute = (recordDiff / timeDiff) * 60000;

        console.log(
          `Progress: ${processedRecords}/${totalRecords} (${Math.floor((processedRecords / totalRecords) * 100)}%) | ` +
            `Speed: ${Math.round(recordsPerMinute)} records/minute | ` +
            `ETA: ${formatTime(((totalRecords - processedRecords) / recordsPerMinute) * 60)} | ` +
            `Active: ${activeJobs.size}`
        );

        lastProgressUpdate.time = now;
        lastProgressUpdate.records = processedRecords;
      }
    }

    // ריקון כל השגיאות שנותרו בבאפר
    await errorBuffer.flushAll();

    // סיום המדידה הכוללת
    overallPerformance.endOperation();
    const metrics = overallPerformance.getFormattedMetrics();

    // לוג סיום העבודה
    console.log(
      `Parent-child job completed: ${processedRecords} records (${totalSuccessCount} success, ${totalFailureCount} failed), duration: ${metrics.totalDuration}`
    );

    // סיכום ביצועים
    const avgDbFetchTime =
      phaseMetrics.dbFetch.count > 0
        ? (phaseMetrics.dbFetch.total / phaseMetrics.dbFetch.count).toFixed(2)
        : "0";
    const avgApiTime =
      phaseMetrics.apiRequest.count > 0
        ? (
            phaseMetrics.apiRequest.total / phaseMetrics.apiRequest.count
          ).toFixed(2)
        : "0";
    const avgResponseProcessingTime =
      phaseMetrics.responseProcessing.count > 0
        ? (
            phaseMetrics.responseProcessing.total /
            phaseMetrics.responseProcessing.count
          ).toFixed(2)
        : "0";

    console.log(`Performance summary:`);
    console.log(
      `- Avg DB Fetch Time: ${avgDbFetchTime}ms (${phaseMetrics.dbFetch.count} operations)`
    );
    console.log(
      `- Avg API Request Time: ${avgApiTime}ms (${phaseMetrics.apiRequest.count} operations)`
    );
    console.log(
      `- Avg Response Processing Time: ${avgResponseProcessingTime}ms (${phaseMetrics.responseProcessing.count} operations)`
    );

    return results;
  } catch (error) {
    console.error(`Fatal error in processParentChildBatches:`, error);

    // ריקון הבאפר גם במקרה של שגיאה
    try {
      await errorBuffer.flushAll();
    } catch (flushError) {
      console.error("Error flushing error buffer:", flushError);
    }

    ProgressTracker.completeJob(
      jobId,
      totalSuccessCount,
      totalFailureCount + (totalRecords - processedRecords)
    );

    results.push({
      success: false,
      failureCount: totalRecords - processedRecords,
      error: error instanceof Error ? error.message : String(error),
    });
    return results;
  }
}

//---------------------------------------------------------------------------
function formatTime(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return `${hrs}h ${mins}m`;
}
//---------------------------------------------------------------------------
async function forceErrorRecordUpdates(
  records: any[],
  jobId: string,
  error: any
): Promise<void> {
  try {
    console.log(
      `Forcing database updates for ${records.length} failed records`
    );

    // Prepare update rows for parent records
    const updateRows = records.map((record) => ({
      RowId: record.__rowId || record.RowId,
      BatchId: record.__batchId,
      JobName: record.__jobType,
      Status: "Failed",
      Error: error instanceof Error ? error.message : String(error),
      JobId: jobId,
      priority_id: null,
      is_new: 1,
      StatusCode: error.status || 500, // Add status code with fallback
    }));

    // Prepare error rows for logging
    const errorRows = records.map((record) => ({
      JobName: record.__jobType,
      BatchId: record.__batchId,
      TableName: record.__tableName,
      RowId: record.__rowId || record.RowId,
      Error: error instanceof Error ? error.message : String(error),
      JobId: jobId,
    }));

    // Batch update the database with error information
    // Determine table name from the first record
    const tableName = records[0]?.__tableName || "";

    if (tableName && updateRows.length > 0) {
      // Use the dataService functions instead of direct DatabaseService calls
      await performBulkUpdateWithService(
        tableName,
        updateRows,
        undefined, // No performance monitor
        1000, // Default batch size
        3 // Default retries
      );
      console.log(
        `Updated ${updateRows.length} parent records with error status`
      );
    }

    if (errorRows.length > 0) {
      // Use the error buffer service instead of direct inserts
      ErrorBufferService.getInstance().addErrors(errorRows);
      console.log(`Buffered ${errorRows.length} error records`);
    }

    // Add support for child records
    if (records[0]?.childRecords) {
      const childUpdatesByTable: { [tableName: string]: any[] } = {};

      // Process child records for each parent
      records.forEach((record) => {
        if (!record.childRecords) return;

        Object.entries(record.childRecords).forEach(
          ([jobType, childRecords]) => {
            if (!Array.isArray(childRecords) || childRecords.length === 0)
              return;

            // Find the table name for this job type
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
                BatchId: record.__batchId,
                JobName: record.__jobType,
                Status: "Failed",
                Error: error instanceof Error ? error.message : String(error),
                JobId: jobId,
                priority_id: null,
                is_new: 1,
              });
            });
          }
        );
      });

      // Update each child table
      for (const [tableName, updates] of Object.entries(
        childUpdatesByTable
      ) as [string, any[]][]) {
        if (updates.length > 0) {
          await performBulkUpdateWithService(tableName, updates);
          console.log(
            `Updated ${updates.length} child records in ${tableName}`
          );
        }
      }
    }
  } catch (dbError) {
    console.error(`Failed to update database with error information:`, dbError);
  }
}

//---------------------------------------------------------------------------
// TODO: need to change it and get the batch size from PriorityJobTypes table
// Helper function to get batch size from configuration
async function getBatchSize(): Promise<number> {
  try {
    const result = await DatabaseService.executeQuery(
      `SELECT ConfigValue FROM PrioritySystemConfig WHERE ConfigKey = 'BATCH_SIZE'`
    );

    return result && result[0]
      ? parseInt((result[0] as { ConfigValue: string }).ConfigValue, 10)
      : 1000; // Default batch size
  } catch (error) {
    console.error("Error fetching batch size:", error);
    return 1000; // Default batch size if we can't get the config
  }
}

//---------------------------------------------------------------------------
export { processParentChildBatches };
