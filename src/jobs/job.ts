// job.ts

import { poolPromise } from "../config/db";
import { config } from "../config/config";
import { configService } from "../config/configService";
import ProgressTracker from "../utils/progressTracker";
import axios from "axios";
import PerformanceMonitor from "../utils/performanceMonitor";
import sql from "mssql";
import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";

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

let BATCH_SIZE: number;
let CONCURRENT_BATCHES: number;
let DELAY_BETWEEN_BATCHES: number;
let limit: any;

(async () => {
  const config_service = await configService.getConfig();
  BATCH_SIZE = config_service.BATCH_SIZE;
  CONCURRENT_BATCHES = config_service.CONCURRENT_BATCHES;
  DELAY_BETWEEN_BATCHES = config_service.DELAY_BETWEEN_BATCHES;
  limit = pLimit(CONCURRENT_BATCHES);
})();

// const BATCH_SIZE = 100; // Number of records to send in each batch
// const CONCURRENT_BATCHES = 10; // Number of batches to send concurrently
// const DELAY_BETWEEN_BATCHES = 6000; // Delay between each batch in milliseconds

const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

const logErrorToTable = async (
  pool: sql.ConnectionPool,
  jobType: string,
  batchId: string,
  tableName: string,
  rowId: number,
  error: string,
  jobId: string
) => {
  await pool
    .request()
    .input("JobName", sql.NVarChar, jobType)
    .input("BatchId", sql.UniqueIdentifier, batchId)
    .input("TableName", sql.NVarChar, tableName)
    .input("RowId", sql.Int, rowId)
    .input("Error", sql.NVarChar, error)
    .input("Timestamp", sql.DateTime, new Date())
    .input("JobID", sql.UniqueIdentifier, jobId).query(`
      INSERT INTO PriorityErrorLogs (JobName, BatchId, TableName, RowId, Error, Timestamp, JobID)
      VALUES (@JobName, @BatchId, @TableName, @RowId, @Error, @Timestamp, @JobID)
    `);
};

async function processBatch(
  pool: sql.ConnectionPool,
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
      batchBody += `${JSON.stringify(rowData)}\r\n`; // Remove extra newline here
    });

    batchBody += `--${boundary}--\r\n`; // Add newline here

    const response = await axios.post(
      `${config.priorityDEVBaseUrl}/$batch`,
      batchBody,
      {
        headers: {
          "Content-Type": `multipart/mixed;boundary=${boundary}`,
          Authorization: `Basic ${Buffer.from(`${config.priorityPAT}:${config.priorityPassword}`).toString("base64")}`,
        },
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

    for (const [index, row] of rows.entries()) {
      const responseItem = response.data.responses[index];

      // perfMonitor.logResponse(index, responseItem);

      const status =
        responseItem && responseItem.status >= 200 && responseItem.status < 300
          ? "Completed"
          : "Failed";
      const errorMessage =
        status === "Failed"
          ? JSON.stringify(responseItem.body?.FORM?.InterfaceErrors)
          : null;

      await pool
        .request()
        .input("RowId", sql.Int, row.RowId)
        .input("BatchId", sql.UniqueIdentifier, batchId)
        .input("JobName", sql.NVarChar, jobType)
        .input("Status", sql.NVarChar, status)
        .input("ErrorMessage", sql.NVarChar, errorMessage)
        .input("JobID", sql.UniqueIdentifier, jobId).query(`
          UPDATE ${tableName}
          SET BatchId = @BatchId, JobName = @JobName, Status = @Status, Error = @ErrorMessage, JobID = @JobID
          WHERE RowId = @RowId
        `);

      if (status === "Completed") {
        perfMonitor.incrementSuccessCount();
      } else {
        perfMonitor.incrementFailureCount();
        await logErrorToTable(
          pool,
          jobType,
          batchId,
          tableName,
          row.RowId,
          errorMessage ?? "",
          jobId
        );
      }
      perfMonitor.setLastProcessedIndex(row.RowId);
    }

    perfMonitor.endOperation();

    await pool
      .request()
      .input("JobName", sql.NVarChar, jobType)
      .input("BatchID", sql.UniqueIdentifier, batchId)
      .input("JobID", sql.UniqueIdentifier, jobId)
      .input(
        "StartTime",
        sql.DateTime,
        adjustTimeZone(new Date(perfMonitor.metrics.startTime))
      )
      .input(
        "EndTime",
        sql.DateTime,
        adjustTimeZone(new Date(perfMonitor.metrics.endTime))
      )
      .input("TotalRecords", sql.Int, rows.length)
      .input("SuccessCount", sql.Int, perfMonitor.metrics.successCount)
      .input("FailureCount", sql.Int, perfMonitor.metrics.failureCount)
      .input(
        "LastProcessedIndex",
        sql.Int,
        perfMonitor.metrics.lastProcessedIndex
      )
      .input("Status", sql.NVarChar, result.success ? "Completed" : "Failed")
      .input("ErrorMessage", sql.NVarChar, result.success ? null : result.error)
      .input("TableName", sql.NVarChar, tableName).query(`
        INSERT INTO PriorityBatchProcessing (JobName, BatchID, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage, TableName, JobID)
        VALUES (@JobName, @BatchID, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage, @TableName, @JobID)
      `);

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
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }

  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount);

  const results: BatchCreateRowsResult[] = [];
  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;

  // Process data in chunks to avoid memory issues
  const FETCH_SIZE = BATCH_SIZE * 5;

  while (processedCount < recordCount) {
    // Calculate how many records to fetch in this iteration
    const fetchCount = Math.min(FETCH_SIZE, recordCount - processedCount);

    // Use proper streaming pattern for mssql
    return new Promise<BatchCreateRowsResult[]>((resolve, reject) => {
      let currentBatch: any[] = [];
      let batchPromises: Promise<any>[] = [];

      const request = pool.request();
      const query = `
        SELECT TOP (${fetchCount}) RowId, Data
        FROM ${tableName}
        WHERE Status IS NULL 
        AND RowId >= ${startRow + processedCount}
        ORDER BY RowId
      `;

      request.stream = true;
      request.query(query);

      request.on("row", (row: { RowId: number; Data: string }) => {
        // Parse the row data
        const processedRow = {
          RowId: row.RowId,
          ...JSON.parse(row.Data),
        };

        // Add to current batch
        currentBatch.push(processedRow);

        // When batch is full, process it
        if (currentBatch.length >= BATCH_SIZE) {
          const batchId = uuidv4();
          const batchToProcess = [...currentBatch];
          currentBatch = [];

          // Process the batch
          batchPromises.push(
            limit(() =>
              processBatch(
                pool,
                batchToProcess,
                batchId,
                jobType,
                tableName,
                priorityScreenName,
                jobId
              )
            ).then((result: BatchCreateRowsResult) => {
              results.push(result);

              // Update processing counts for progress tracking
              processedCount += batchToProcess.length;
              successCount += result.success ? result.rowsCount || 0 : 0;
              failureCount += !result.success ? result.rowsCount || 0 : 0;

              // Update progress
              ProgressTracker.updateProgress(
                jobId,
                processedCount,
                successCount,
                failureCount
              );

              // Add delay between batches
              return new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES));
            })
          );

          processedCount += batchToProcess.length;
        }
      });

      request.on("error", (err: Error) => {
        console.error("Error in database stream:", err);
        // Update progress with failure status
        ProgressTracker.completeJob(jobId, successCount, failureCount + 1);
        reject(err);
      });

      request.on("done", async () => {
        // Process any remaining rows in the final batch
        if (currentBatch.length > 0) {
          const batchId = uuidv4();
          batchPromises.push(
            limit(() =>
              processBatch(
                pool,
                currentBatch,
                batchId,
                jobType,
                tableName,
                priorityScreenName,
                jobId
              )
            ).then((result: BatchCreateRowsResult) => {
              results.push(result);

              // Update counts
              successCount += result.success ? result.rowsCount || 0 : 0;
              failureCount += !result.success ? result.rowsCount || 0 : 0;
            })
          );
          processedCount += currentBatch.length;
        }

        // Wait for all batch promises to resolve
        try {
          await Promise.all(batchPromises);

          // Mark job as complete
          ProgressTracker.completeJob(jobId, successCount, failureCount);

          resolve(results);
        } catch (error) {
          // Update progress with failure status
          ProgressTracker.completeJob(jobId, successCount, failureCount);
          reject(error);
        }
      });
    });
  }

  return results;
}


export { processBatch, processBatches };
