// job.ts

import { DatabaseService } from "../services/databaseService";
import { config } from "../config/config";
import { configService } from "../config/configService";
import ProgressTracker from "../utils/progressTracker";
import axios from "axios";
import PerformanceMonitor from "../utils/performanceMonitor";
import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";
import http from "http";
import https from "https";

// Create reusable HTTP/HTTPS agents with keep-alive enabled
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  keepAliveMsecs: 30000, // Keep connections alive for 30 seconds
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  keepAliveMsecs: 30000,
});

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

//--------------------------------------------
async function performBulkUpdateWithService(tableName: string, updates: any[]) {
  if (updates.length === 0) return;

  try {
    // Execute the stored procedure with parameters
    await DatabaseService.executeStoredProcedure("dbo.BulkUpdateRows", {
      TableName: tableName,
      Updates: {
        tvpType: "dbo.BatchUpdateTableType",
        tvpValue: updates.map((update) => ({
          RowId: update.RowId,
          BatchId: update.BatchId,
          JobName: update.JobName,
          Status: update.Status,
          ErrorMessage: update.ErrorMessage,
          JobID: update.JobID,
        })),
      },
    });
  } catch (error) {
    console.error("Error performing bulk update:", error);
    throw error;
  }
}

async function performBulkErrorInsertWithService(errors: any[]) {
  if (errors.length === 0) return;

  try {
    // Execute the stored procedure with parameters
    await DatabaseService.executeStoredProcedure("dbo.BulkInsertErrorLogs", {
      Errors: {
        tvpType: "dbo.ErrorLogTableType",
        tvpValue: errors.map((error) => ({
          JobName: error.JobName,
          BatchId: error.BatchId,
          TableName: error.TableName,
          RowId: error.RowId,
          Error: error.Error,
          JobID: error.JobID,
        })),
      },
    });
  } catch (error) {
    console.error("Error performing bulk error insert:", error);
    throw error;
  }
}
//--------------------------------------------
async function processBatch(
  rows: any[],
  batchId: string,
  jobType: string,
  tableName: string,
  priorityScreenName: string,
  jobId: string
) {
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("Invalid rows data");
    }

    perfMonitor.logRequestMetrics(rows);

    const boundary = `batch_${Date.now()}`;
    let batchBody = "";

    rows.forEach((row: any, index: number) => {
      const { RowId, ...rowData } = row; // Remove RowId from row object
      batchBody += `--${boundary}\r\n`;
      batchBody += `Content-Type: application/http\r\n`;
      batchBody += `Content-Transfer-Encoding: binary\r\n\r\n`;
      batchBody += `POST ${priorityScreenName} HTTP/1.1\r\n`;
      batchBody += `Content-Type: application/json\r\n\r\n`;
      batchBody += `${JSON.stringify(rowData)}\r\n`;
    });

    batchBody += `--${boundary}--\r\n`;

    //Loggin the batch body
    // Log the request details before sending
    // console.log("===== BATCH REQUEST DETAILS =====");
    // console.log("URL:", `${config.priorityDEVBaseUrl}/$batch`);
    // console.log("Headers:", {
    //   "Content-Type": `multipart/mixed;boundary=${boundary}`,
    //   Authorization: "Basic ********", // Masked for security
    //   Connection: "keep-alive",
    // });
    // console.log("Batch Body:");
    // console.log(batchBody);
    // console.log("Total Body Length:", batchBody.length);
    // console.log("================================");

    // Make the API call to Priority Cloud (this part stays the same)
    const response = await axios.post(
      `${config.priorityDEVBaseUrl}/$batch`,
      batchBody,
      {
        headers: {
          "Content-Type": `multipart/mixed;boundary=${boundary}`,
          Authorization: `Basic ${Buffer.from(`${config.priorityPAT}:${config.priorityPassword}`).toString("base64")}`,
          Connection: "keep-alive",
        },
        // Add keep-alive agent configuration
        httpAgent: httpAgent,
        httpsAgent: httpsAgent,
      }
    );

    perfMonitor.logResponseMetrics(response.data, response.status);

    const result: BatchCreateRowsResult = {
      success: true,
      message: "Batch created successfully",
      rowsCount: rows.length,
      data: response.data,
      requestSize: perfMonitor.metrics.requestSize,
      responseSize: perfMonitor.metrics.responseSize,
      duration: perfMonitor.metrics.duration,
      averageTimePerRecord: perfMonitor.metrics.averageTimePerRecord,
    };

    // Prepare collections for bulk operations
    const updateRows = [];
    const errorRows = [];

    // Process all response items without database calls
    for (const [index, row] of rows.entries()) {
      const responseItem = response.data.responses[index];

      const status =
        responseItem && responseItem.status >= 200 && responseItem.status < 300
          ? "Completed"
          : "Failed";
      const errorMessage =
        status === "Failed"
          ? JSON.stringify(responseItem.body?.FORM?.InterfaceErrors)
          : null;

      // Add to update collection
      updateRows.push({
        RowId: row.RowId,
        BatchId: batchId,
        JobName: jobType,
        Status: status,
        ErrorMessage: errorMessage,
        JobID: jobId,
      });

      // Track metrics
      if (status === "Completed") {
        perfMonitor.incrementSuccessCount();
      } else {
        perfMonitor.incrementFailureCount();

        // Add to error collection if failed
        errorRows.push({
          JobName: jobType,
          BatchId: batchId,
          TableName: tableName,
          RowId: row.RowId,
          Error: errorMessage || "",
          JobID: jobId,
        });
      }

      perfMonitor.setLastProcessedIndex(row.RowId);
    }

    // Perform bulk operations
    if (updateRows.length > 0) {
      await performBulkUpdateWithService(tableName, updateRows);
    }

    if (errorRows.length > 0) {
      await performBulkErrorInsertWithService(errorRows);
    }

    perfMonitor.endOperation();

    // Insert batch processing record (this can remain a single operation)
    await DatabaseService.executeQuery(
      `
      INSERT INTO PriorityBatchProcessing (JobName, BatchID, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage, TableName, JobID)
      VALUES (@JobName, @BatchID, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage, @TableName, @JobID)
    `,
      {
        JobName: jobType,
        BatchID: batchId,
        JobID: jobId,
        StartTime: adjustTimeZone(new Date(perfMonitor.metrics.startTime)),
        EndTime: adjustTimeZone(new Date(perfMonitor.metrics.endTime)),
        TotalRecords: rows.length,
        SuccessCount: perfMonitor.metrics.successCount,
        FailureCount: perfMonitor.metrics.failureCount,
        LastProcessedIndex: perfMonitor.metrics.lastProcessedIndex,
        Status: result.success ? "Completed" : "Failed",
        ErrorMessage: result.success ? null : result.error,
        TableName: tableName,
      }
    );

    return result;
  } catch (error) {
    perfMonitor.logError(error);
    console.error("Error in processBatch:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

//--------------------------------------------
async function processBatches(
  recordCount: number,
  startRow: number,
  tableName: string,
  priorityScreenName: string,
  jobType: string,
  jobId: string
) {
  const config = await configService.getConfig();
  const BATCH_SIZE = config.BATCH_SIZE;
  const CONCURRENT_BATCHES = config.CONCURRENT_BATCHES;
  const DELAY_BETWEEN_BATCHES = config.DELAY_BETWEEN_BATCHES;
  const MIN_DELAY = config.MIN_DELAY || 100; // Minimum delay in milliseconds (default: 100ms)
  const MAX_DELAY = config.MAX_DELAY || 5000; // Maximum delay in milliseconds (default: 5000ms)
  const limit = pLimit(CONCURRENT_BATCHES);

  // const pool = await poolPromise;
  // if (!pool) {
  //   throw new Error("Failed to connect to the database");
  // }

  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount);

  // Track overall progress
  let totalProcessedRecords = 0;
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  const results = [];

  // Process in chunks of 1000 records
  const CHUNK_SIZE = 1000;
  let processedCount = 0;
  let lastRowId = startRow - 1;

  while (processedCount < recordCount) {
    const chunkSize = Math.min(CHUNK_SIZE, recordCount - processedCount);
    const query = `
      SELECT TOP (${chunkSize}) RowId, Data
      FROM ${tableName}
      WHERE Status IS NULL AND RowId > ${lastRowId}
      ORDER BY RowId ASC
    `;

    const rowsData = await DatabaseService.executeQuery(query);
    if (rowsData.length === 0) break;

    // Process this chunk
    const rows = rowsData.map((record: any) => ({
      RowId: record.RowId,
      ...JSON.parse(record.Data),
    }));

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

    lastRowId = (rowsData[rowsData.length - 1] as { RowId: number }).RowId;
    processedCount += rowsData.length;
  }

  // Mark job as complete when all batches are done
  ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

  return results;
}

export { processBatch, processBatches };
