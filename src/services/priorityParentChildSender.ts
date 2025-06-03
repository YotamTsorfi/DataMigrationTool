import { configService } from "../config/configService"; // DB
import { v4 as uuidv4 } from "uuid";
import pLimit from "p-limit";
import PerformanceMonitor from "../utils/performanceMonitor";
import {
  buildBatchRequestBody,
  createBatchHeaders,
  generateBoundary,
} from "../services/requestBuilder";
import {
  sendBatchRequest,
  measureRequestPerformance,
} from "../services/requestSender";
import { processParentChildResponse } from "./priorityParentChildResponseProcessor";
import { ChildJob } from "../jobs/jobParentAndChilds";
// import { writeToLogFile } from "../config/logger";

// תוצאת שליחה של מנה (Batch)
export interface BatchSendResult {
  success: boolean;
  batchId: string;
  message?: string;
  rowsCount: number;
  successCount: number;
  failureCount: number;
  responseCount?: number;
  error?: any;
  duration?: number;
  averageTimePerRecord?: string;
  performanceMetrics?: {
    dbFetchTime: string;
    dbUpdateTime: string;
    batchBuildTime: string;
    requestTime: string;
    totalDuration: string;
  };
}
//-------------------------------------------------------------------------
/**
 * שליחת רשומות אב-ילדים מאוחדות לשרת Priority
 * @param records - מערך של אובייקטי JSON מאוחדים (אב + ילדים)
 * @param jobType - סוג העבודה
 * @param tableName - שם טבלת האב
 * @param priorityScreenName - שם המסך בפריוריטי
 * @param jobId - מזהה העבודה
 * @param priorityIdField - שדה המזהה בפריוריטי (אופציונלי)
 * @param childTableNames - מערך של שמות טבלאות הילדים (אופציונלי)
 */
export async function sendParentChildBatch(
  records: any[],
  jobType: string,
  tableName: string,
  priorityScreenName: string,
  jobId: string,
  priorityIdField?: string,
  childTableNames?: string[],
  childJobs?: ChildJob[],
  logErrors: boolean = false,
  updateBatchTable: boolean = false,
): Promise<BatchSendResult> {
  // יצירת מזהה ייחודי למנה
  const batchId = uuidv4();
  const config = await configService.getConfig();

  // הגדרת מונה ביצועים
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error("Invalid records data");
    }

    // הוספת מידע נוסף לכל רשומה
    perfMonitor.startBatchBuild();
    const enrichedRecords = records.map((record) => ({
      ...record,
      __batchId: batchId,
      __jobType: jobType,
      __tableName: tableName,
      __jobId: jobId,
      __priorityScreenName: priorityScreenName,
      RowId: record.RowId,
    }));

    // Create clean records for sending to API, keeping enrichedRecords for tracking
    const cleanRecordsForApi = enrichedRecords.map((record) => {
      const { childRecords, RowId, ...cleanRecord } = record;
      return cleanRecord;
    });

    // מדידת זמן הבקשה
    measureRequestPerformance(cleanRecordsForApi, perfMonitor);

    // בניית גוף הבקשה
    const boundary = generateBoundary();
    const batchBody = buildBatchRequestBody(cleanRecordsForApi, boundary);

    // יצירת כותרות HTTP עם אימות
    const headers = createBatchHeaders(
      boundary,
      `Basic ${Buffer.from(`${config.PRIORITY_PAT}:${config.PRIORITY_PASSWORD}`).toString("base64")}`,
    );
    perfMonitor.endBatchBuild();

    // מדידת זמן השליחה
    perfMonitor.startRequest();

    //--------------------------------------
    // ------ DEBUGGING: Write the raw data to a file for inspection ------
    // writeToLogFile(
    //   'Requestheader.log',
    //   `=== REQUEST HEADERS ===\n${JSON.stringify({
    //     ...headers,
    //     Authorization: headers.Authorization ? '[REDACTED]' : undefined
    //   }, null, 2)}\n\n`
    // );

    // // Log the full batch body
    // writeToLogFile(
    //   'Requestbody.log',
    //   `=== BATCH BODY ===\n${batchBody}\n\n`
    // );
    //--------------------------------------

    // שליחת הבקשה
    let response;
    try {
      response = await sendBatchRequest(batchBody, headers);
      perfMonitor.endRequest();
    } catch (error) {
      perfMonitor.logError(error);
      console.error("Error sending parent-child batch request:", error);

      // Create a fake response structure to ensure processing continues
      response = {
        status: 500,
        data: {
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
      };

      // Still continue with response processing to ensure database updates happen
      console.log(
        "Created fallback response structure to continue with database updates",
      );
    }

    /**
     * עיבוד התגובה מה-API
     */
    const result = await processParentChildResponse(
      response,
      enrichedRecords,
      perfMonitor,
      tableName,
      batchId,
      jobType,
      jobId,
      priorityIdField,
      childTableNames,
      childJobs,
      logErrors,
      updateBatchTable,
    );

    return {
      success: result.success,
      batchId: batchId,
      message: result.message,
      rowsCount: records.length,
      successCount: result.successCount,
      failureCount: result.failureCount,
      responseCount: result.responseCount,
      duration: perfMonitor.metrics.duration,
      averageTimePerRecord: result.averageTimePerRecord,
      performanceMetrics: result.performanceMetrics,
    };
  } catch (error) {
    perfMonitor.logError(error);
    console.error("Error in sendParentChildBatch:", error);
    return {
      success: false,
      batchId: batchId,
      error: error instanceof Error ? error.message : "Unknown error",
      rowsCount: records.length,
      successCount: 0,
      failureCount: records.length,
    };
  }
}
//-------------------------------------------------------------------------
/**
 * שליחת סט מנות במקביל עם הגבלת מקבוליות
 * @param batches - מערך של מנות נתונים לשליחה
 * @param concurrency - מספר שליחות מקביל מקסימלי
 * @param jobType - סוג העבודה
 * @param tableName - שם הטבלה
 * @param priorityScreenName - שם המסך בפריוריטי
 * @param jobId - מזהה העבודה
 * @param priorityIdField - שדה המזהה בפריוריטי (אופציונלי)
 * @param childTableNames - מערך של שמות טבלאות הילדים (אופציונלי)
 */
export async function sendParentChildBatchesInParallel(
  batches: any[][],
  concurrency: number,
  jobType: string,
  tableName: string,
  priorityScreenName: string,
  jobId: string,
  priorityIdField?: string,
  childTableNames?: string[],
  childJobs?: ChildJob[],
  logErrors: boolean = false,
  updateBatchTable: boolean = false,
): Promise<BatchSendResult[]> {
  // Explicitly ensure concurrency is capped
  //TODO
  // const effectiveConcurrency = Math.min(concurrency, 10); // Never exceed 10 concurrent batches
  // const limit = pLimit(effectiveConcurrency);
  const limit = pLimit(concurrency);

  // console.log(`Sending ${batches.length} batches with max concurrency of ${effectiveConcurrency}`);

  // Send all batches in parallel with concurrency limit
  const sendPromises = batches.map((batch, index) =>
    limit(async () => {
      // console.log(`Starting batch ${index + 1}/${batches.length} with ${batch.length} records`);
      const result = await sendParentChildBatch(
        batch,
        jobType,
        tableName,
        priorityScreenName,
        jobId,
        priorityIdField,
        childTableNames,
        childJobs,
        logErrors,
        updateBatchTable,
      );
      // console.log(`Completed batch ${index + 1}/${batches.length}`);
      return {
        ...result,
        performanceMetrics: result.performanceMetrics || {
          dbFetchTime: "0ms",
          dbUpdateTime: "0ms",
          batchBuildTime: "0ms",
          requestTime: "0ms",
          totalDuration: "0ms",
        },
      };
    }),
  );

  // Wait for all batches to complete
  const results = await Promise.all(sendPromises);

  // Summarize results
  // const totalRecords = batches.reduce((sum, batch) => sum + batch.length, 0);
  // const successfulRecords = results.reduce(
  //   (sum, result) => sum + result.successCount,
  //   0
  // );
  // const failedRecords = results.reduce(
  //   (sum, result) => sum + result.failureCount,
  //   0
  // );

  // console.log(`Completed sending ${batches.length} batches: ${successfulRecords} successful, ${failedRecords} failed out of ${totalRecords} total records`);

  // Help garbage collection
  batches.forEach((batch) => {
    if (batch && Array.isArray(batch)) {
      batch.length = 0;
    }
  });

  return results;
}
