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
  performBulkErrorInsertWithService,
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

interface BatchCreateRowsResult {
  success: boolean;
  message?: string;
  rowsCount?: number;
  data?: any;
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
  dbFetchTime?: number
): Promise<BatchCreateRowsResult> {
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
    const response = await sendBatchRequest(batchBody, headers);
    perfMonitor.endRequest();

    // Measure response performance
    measureResponsePerformance(response, perfMonitor);

    // Process API response
    const {
      updateRows,
      errorRows,
      successCount,
      failureCount,
      lastProcessedIndex,
      sentToPriority
    } = processApiResponse(response, enrichedRows);

    // Update performance metrics
    perfMonitor.metrics.successCount = successCount;
    perfMonitor.metrics.failureCount = failureCount;
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // Track all DB update operations
    let totalDbUpdateTime = 0;
    let batchStatus = successCount === rows.length ? "Completed" : "Failed";

    // Perform bulk operations with the performance monitor
    if (updateRows.length > 0) {
      try {
        const updateTime = await performBulkUpdateWithService(
          tableName,
          updateRows,
          perfMonitor,
          undefined,
          3, // מספר ניסיונות
          sentToPriority // העבר את הדגל שמציין שהנתונים נשלחו לפריוריטי
        );
        totalDbUpdateTime += updateTime;
      } catch (dbError) {
        console.error("Error during database update:", dbError);
        
        // אם יש שגיאת דאטהבייס אחרי שהנתונים נשלחו לפריוריטי
        const isDeadlock = 
          (dbError as any)?.number === 1205 || 
          (dbError as any)?.originalError?.info?.number === 1205 ||
          (dbError instanceof Error && dbError.message.includes("deadlock"));
          
        if (isDeadlock && sentToPriority) {
          console.log(`Batch ${batchId} was sent to Priority but failed DB update due to deadlock - marking as 'CompletedButNotSynced'`);
          
          // עדכון סטטוס הבאצ'
          batchStatus = "CompletedButNotSynced";
        } else {
          throw dbError;
        }
      }
    }


    if (errorRows.length > 0) {
      try {
        const errorInsertTime = await performBulkErrorInsertWithService(
          errorRows,
          perfMonitor
        );
        totalDbUpdateTime += errorInsertTime;
      } catch (errorInsertError) {
        console.error("Failed to insert error logs:", errorInsertError);
        // אל תפסיק את התהליך, פשוט המשך
      }
    }

    // If we tracked update time separately, make sure it's recorded in case perfMonitor didn't track it
    if (totalDbUpdateTime > 0 && !perfMonitor.metrics.dbUpdateTime) {
      perfMonitor.setDbUpdateTime(totalDbUpdateTime);
    }

    perfMonitor.endOperation();

    // Get formatted metrics for the result
    const formattedMetrics = perfMonitor.getFormattedMetrics();

    // Record batch processing results
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
      batchStatus, // השתמש בסטטוס המתאים - Completed, Failed או CompletedButNotSynced
      batchStatus === "CompletedButNotSynced" ? "DB update failed due to deadlock after Priority success" : null,
      tableName
    );


    return {
      success: true,
      message: "Batch created successfully",
      rowsCount: rows.length,
      data: response.data,
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
  jobId: string
): Promise<any[]> {
  const config = await configService.getConfig();
  const BATCH_SIZE = config.BATCH_SIZE;
  const CONCURRENT_BATCHES = config.CONCURRENT_BATCHES;
  const DELAY_BETWEEN_BATCHES = config.DELAY_BETWEEN_BATCHES;
  const MIN_DELAY = config.MIN_DELAY || 100; // Minimum delay in milliseconds
  const MAX_DELAY = config.MAX_DELAY || 500; // Maximum delay in milliseconds
  const limit = pLimit(CONCURRENT_BATCHES);

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
            perfMonitor.metrics.dbFetchTime
          )
        )
      );
    }

    let currentDelay = DELAY_BETWEEN_BATCHES;
    for (const batchPromise of batchPromises) {
      const startTime = Date.now();
      const result = await batchPromise;
      const processingTime = Date.now() - startTime;

      results.push(result);

      // Log detailed performance metrics for each batch
      // if (result.performanceMetrics) {
      //   console.log(`Batch Performance Metrics:`, {
      //     dbFetchTime: result.performanceMetrics.dbFetchTime,
      //     dbUpdateTime: result.performanceMetrics.dbUpdateTime,
      //     batchBuildTime: result.performanceMetrics.batchBuildTime,
      //     requestTime: result.performanceMetrics.requestTime,
      //     totalDuration: result.performanceMetrics.totalDuration,
      //   });
      // }

      // Update progress metrics after each batch completes
      if (result.success) {
        totalProcessedRecords += result.rowsCount || 0;
        // Extract success and failure counts from the batch result
        if (result.data && result.data.responses) {
          const batchSuccessCount = result.data.responses.filter(
            (r: any) => r.status >= 200 && r.status < 300
          ).length;
          const batchFailureCount = (result.rowsCount || 0) - batchSuccessCount;

          totalSuccessCount += batchSuccessCount;
          totalFailureCount += batchFailureCount;
        }
      }

      // Update progress tracker
      ProgressTracker.updateProgress(
        jobId,
        totalProcessedRecords,
        totalSuccessCount,
        totalFailureCount
      );

      // Adjust delay based on processing time
      if (processingTime > currentDelay) {
        currentDelay = Math.min(currentDelay * 1.5, MAX_DELAY); // Slow down
      } else if (processingTime < currentDelay / 2) {
        currentDelay = Math.max(currentDelay * 0.8, MIN_DELAY); // Speed up
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
    }

    lastRowId = (rows[rows.length - 1] as { RowId: number }).RowId;
    processedCount += rows.length;
  }

  // Mark job as complete when all batches are done
  ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

  return results;
}

export { processBatch, processBatches };
