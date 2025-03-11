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
}

const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

/**
 * Process a batch of rows by sending them to Priority API
 */
async function processBatch(
  rows: any[],
  batchId: string,
  jobType: string,
  tableName: string,
  priorityScreenName: string,
  jobId: string
): Promise<BatchCreateRowsResult> {
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Invalid rows data");
    }

    // console.log(
    //   `[DEBUG] Processing batch of ${rows.length} records with batchId: ${batchId}`
    // );
    // console.log(`[DEBUG] Using priorityScreenName: ${priorityScreenName}`);

    // Add metadata to rows for processing
    const enrichedRows = rows.map((row) => ({
      ...row,
      __batchId: batchId,
      __jobType: jobType,
      __tableName: tableName,
      __jobId: jobId,
      __priorityScreenName: priorityScreenName,
    }));

    // DEBUG: Log the first enriched row
    // console.log(
    //   "[DEBUG] First row data sample:",
    //   JSON.stringify(enrichedRows[0]).substring(0, 200)
    // );

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

    // DEBUG: Log headers (without auth token)
    // console.log("[DEBUG] Request headers:", {
    //   ...headers,
    //   Authorization: "*** REDACTED ***",
    // });

    // Send the request
    const response = await sendBatchRequest(batchBody, headers);

    // Measure response performance
    measureResponsePerformance(response, perfMonitor);

    // Process API response
    const {
      updateRows,
      errorRows,
      successCount,
      failureCount,
      lastProcessedIndex,
    } = processApiResponse(response, enrichedRows);

    // Log summary of processed response
    // console.log("[DEBUG] Response processing summary:");
    // console.log(`- Success: ${successCount}, Failures: ${failureCount}`);
    // console.log(`- Updates: ${updateRows.length}, Errors: ${errorRows.length}`);

    // Update performance metrics
    perfMonitor.metrics.successCount = successCount;
    perfMonitor.metrics.failureCount = failureCount;
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // Perform bulk operations
    if (updateRows.length > 0) {
      await performBulkUpdateWithService(tableName, updateRows);
    }

    if (errorRows.length > 0) {
      await performBulkErrorInsertWithService(errorRows);
    }

    perfMonitor.endOperation();

    // Record batch processing results
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
      successCount === rows.length ? "Completed" : "Failed",
      null,
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
      averageTimePerRecord: perfMonitor.metrics.averageTimePerRecord,
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
  const MAX_DELAY = config.MAX_DELAY || 5000; // Maximum delay in milliseconds
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

    // Fetch data chunk from database
    const rows = await fetchDataChunk(tableName, lastRowId, chunkSize);

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
            jobId
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
