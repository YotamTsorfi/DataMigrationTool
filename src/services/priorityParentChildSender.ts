import { config } from "../config/config";
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
  childTableNames?: string[]
): Promise<BatchSendResult> {
  // יצירת מזהה ייחודי למנה
  const batchId = uuidv4();
  
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
    }));

    // מדידת זמן הבקשה
    measureRequestPerformance(enrichedRecords, perfMonitor);

    // בניית גוף הבקשה
    const boundary = generateBoundary();
    const batchBody = buildBatchRequestBody(enrichedRecords, boundary);

    // יצירת כותרות HTTP עם אימות
    const headers = createBatchHeaders(
      boundary,
      `Basic ${Buffer.from(`${config.priorityPAT}:${config.priorityPassword}`).toString("base64")}`
    );
    perfMonitor.endBatchBuild();

    // מדידת זמן השליחה
    perfMonitor.startRequest();
    
    // שליחת הבקשה
    let response;
    try {
      response = await sendBatchRequest(batchBody, headers);
      perfMonitor.endRequest();
    } catch (error) {
      perfMonitor.logError(error);
      console.error("Error sending parent-child batch request:", error);
      return {
        success: false,
        batchId: batchId,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "Failed to communicate with Priority API",
        rowsCount: records.length,
        successCount: 0,
        failureCount: records.length,
      };
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
      childTableNames
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
  childTableNames?: string[]
): Promise<BatchSendResult[]> {
  // הגבלת מספר השליחות המקבילות
  const limit = pLimit(concurrency);
  
  console.log(`Sending ${batches.length} batches with max concurrency of ${concurrency}`);
  
  // שליחת כל המנות במקביל עם הגבלת מקבוליות
  const sendPromises = batches.map((batch, index) => 
    limit(() => {
      console.log(`Starting batch ${index + 1}/${batches.length} with ${batch.length} records`);
      return sendParentChildBatch(
        batch, 
        jobType, 
        tableName, 
        priorityScreenName, 
        jobId, 
        priorityIdField,
        childTableNames
      );
    })
  );
  
  // המתנה לסיום כל השליחות
  const results = await Promise.all(sendPromises);
  
  // סיכום התוצאות
  const totalRecords = batches.reduce((sum, batch) => sum + batch.length, 0);
  const successfulRecords = results.reduce((sum, result) => sum + result.successCount, 0);
  const failedRecords = results.reduce((sum, result) => sum + result.failureCount, 0);
  
  console.log(`Completed sending ${batches.length} batches: ${successfulRecords} successful, ${failedRecords} failed out of ${totalRecords} total records`);
  
  return results;
}