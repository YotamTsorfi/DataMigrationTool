// job.ts

import { poolPromise } from "../config/db";
import axios from "axios";
import { config } from "../config/config";
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

const BATCH_SIZE = 100; // מספר השורות שיכנסו ב-Batch
const CONCURRENT_BATCHES = 10; // כמות ה-Batch שיכולים לרוץ במקביל
const DELAY_BETWEEN_BATCHES = 6000; // דיליי בין השליחות במילישניות

const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

async function processBatch(
  rows: any[],
  batchId: string,
  jobType: string,
  tableName: string,
  priorityScreenName: string
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

      const status =
        responseItem && responseItem.status >= 200 && responseItem.status < 300
          ? "Completed"
          : "Failed";
      const errorMessage =
        status === "Failed"
          ? JSON.stringify(responseItem.body?.error?.message)
          : null;

      await pool
        .request()
        .input("RowId", sql.Int, row.RowId)
        .input("BatchId", sql.UniqueIdentifier, batchId)
        .input("JobName", sql.NVarChar, jobType)
        .input("Status", sql.NVarChar, status)
        .input("ErrorMessage", sql.NVarChar, errorMessage).query(`
          UPDATE ${tableName}
          SET BatchId = @BatchId, JobName = @JobName, Status = @Status, Error = @ErrorMessage
          WHERE RowId = @RowId
        `);

      if (status === "Completed") {
        perfMonitor.incrementSuccessCount();
      } else {
        perfMonitor.incrementFailureCount();
      }
      perfMonitor.setLastProcessedIndex(row.RowId);
    }

    perfMonitor.endOperation();

    await pool
      .request()
      .input("JobName", sql.NVarChar, jobType)
      .input("BatchID", sql.UniqueIdentifier, batchId)
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
        INSERT INTO PriorityBatchProcessing (JobName, BatchID, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage, TableName)
        VALUES (@JobName, @BatchID, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage, @TableName)
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

async function processBatches(
  recordCount: number,
  startRow: number,
  tableName: string,
  priorityScreenName: string,
  jobType: string
) {
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }

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
        processBatch(batch, batchId, jobType, tableName, priorityScreenName)
      )
    );
  }

  const results = [];
  for (const batchPromise of batchPromises) {
    results.push(await batchPromise);
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
  }

  return results;
}

export { processBatch, processBatches };
