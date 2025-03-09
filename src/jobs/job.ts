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

// const logErrorToTable = async (
//   pool: sql.ConnectionPool,
//   jobType: string,
//   batchId: string,
//   tableName: string,
//   rowId: number,
//   error: string,
//   jobId: string
// ) => {
//   await pool
//     .request()
//     .input("JobName", sql.NVarChar, jobType)
//     .input("BatchId", sql.UniqueIdentifier, batchId)
//     .input("TableName", sql.NVarChar, tableName)
//     .input("RowId", sql.Int, rowId)
//     .input("Error", sql.NVarChar, error)
//     .input("Timestamp", sql.DateTime, new Date())
//     .input("JobID", sql.UniqueIdentifier, jobId).query(`
//       INSERT INTO PriorityErrorLogs (JobName, BatchId, TableName, RowId, Error, Timestamp, JobID)
//       VALUES (@JobName, @BatchId, @TableName, @RowId, @Error, @Timestamp, @JobID)
//     `);
// };
async function performBulkUpdate(
  pool: sql.ConnectionPool,
  tableName: string,
  updates: any[]
) {
  if (updates.length === 0) return;
  
  try {
    // Create a table-valued parameter
    const table = new sql.Table('dbo.BatchUpdateTableType');
    
    // Define table structure
    table.columns.add('RowId', sql.Int, { nullable: false });
    table.columns.add('BatchId', sql.UniqueIdentifier, { nullable: false });
    table.columns.add('JobName', sql.NVarChar(255), { nullable: false });
    table.columns.add('Status', sql.NVarChar(50), { nullable: false });
    table.columns.add('ErrorMessage', sql.NVarChar(sql.MAX), { nullable: true });
    table.columns.add('JobID', sql.UniqueIdentifier, { nullable: false });
    
    // Add all rows
    updates.forEach(update => {
      table.rows.add(
        update.RowId,
        update.BatchId,
        update.JobName,
        update.Status,
        update.ErrorMessage,
        update.JobID
      );
    });
    
    // Execute the stored procedure with the TVP
    await pool.request()
      .input('TableName', sql.NVarChar, tableName)
      .input('Updates', table)
      .execute('dbo.BulkUpdateRows');
      
  } catch (error) {
    console.error('Error performing bulk update:', error);
    throw error;
  }
}

async function performBulkErrorInsert(
  pool: sql.ConnectionPool,
  errors: any[]
) {
  if (errors.length === 0) return;
  
  try {
    // Create a table-valued parameter
    const table = new sql.Table('dbo.ErrorLogTableType');
    
    // Define table structure
    table.columns.add('JobName', sql.NVarChar(255), { nullable: false });
    table.columns.add('BatchId', sql.UniqueIdentifier, { nullable: false });
    table.columns.add('TableName', sql.NVarChar(255), { nullable: false });
    table.columns.add('RowId', sql.Int, { nullable: false });
    table.columns.add('Error', sql.NVarChar(sql.MAX), { nullable: true });
    table.columns.add('JobID', sql.UniqueIdentifier, { nullable: false });
    
    // Add all error rows
    errors.forEach(error => {
      table.rows.add(
        error.JobName,
        error.BatchId,
        error.TableName,
        error.RowId,
        error.Error,
        error.JobID
      );
    });
    
    // Execute the stored procedure with the TVP
    await pool.request()
      .input('Errors', table)
      .execute('dbo.BulkInsertErrorLogs');
      
  } catch (error) {
    console.error('Error performing bulk error insert:', error);
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
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }

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

    // Make the API call to Priority Cloud (this part stays the same)
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
        JobID: jobId
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
          JobID: jobId
        });
      }
      
      perfMonitor.setLastProcessedIndex(row.RowId);
    }

    // Perform bulk operations
    if (updateRows.length > 0) {
      await performBulkUpdate(pool, tableName, updateRows);
    }

    if (errorRows.length > 0) {
      await performBulkErrorInsert(pool, errorRows);
    }

    perfMonitor.endOperation();

    // Insert batch processing record (this can remain a single operation)
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

  const limit = pLimit(CONCURRENT_BATCHES);

  const rowsData = await pool.request().query(`
    SELECT TOP (${recordCount}) RowId, Data
    FROM ${tableName}
    WHERE Status IS NULL AND RowId >= ${startRow}
  `);

  const rows = rowsData.recordset.map((record: any) => ({
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

  // Track overall progress
  let totalProcessedRecords = 0;
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  const results = [];

  for (const batchPromise of batchPromises) {
    const result = await batchPromise;
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

    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
  }

  // Mark job as complete when all batches are done
  ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

  return results;
}

export { processBatch, processBatches };
