// job.ts

import { poolPromise } from "../config/db";
import axios from "axios";
import { config } from "../config/config";
import PerformanceMonitor from "../utils/performanceMonitor";
import sql from "mssql";
import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";

interface BatchCreateVehiclesResult {
  success: boolean;
  message?: string;
  vehiclesCount?: number;
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

async function processBatch(vehicles: any[], batchId: string, jobId: string) {
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }

  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    if (!Array.isArray(vehicles) || vehicles.length === 0) {
      throw new Error("Invalid vehicles data");
    }

    perfMonitor.logRequestMetrics({ vehicles });

    const boundary = `batch_${Date.now()}`;
    let batchBody = "";

    vehicles.forEach((vehicle: any, index: number) => {
      const { RowId, ...vehicleData } = vehicle; // Remove RowId from vehicle object
      batchBody += `--${boundary}\r\n`;
      batchBody += `Content-Type: application/http\r\n`;
      batchBody += `Content-Transfer-Encoding: binary\r\n\r\n`;
      batchBody += `POST NATF_VEHICLES HTTP/1.1\r\n`;
      batchBody += `Content-Type: application/json\r\n\r\n`;
      batchBody += `${JSON.stringify(vehicleData)}\r\n\r\n`;
    });

    batchBody += `--${boundary}--`;

    // Debug Request (all rows) Log the request body for debugging
    //console.log("Batch Request Body:", batchBody);

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

    const result: BatchCreateVehiclesResult = {
      success: true,
      message: "Batch vehicles created successfully",
      vehiclesCount: vehicles.length,
      data: response.data,
      requestSize: perfMonitor.metrics.requestSize,
      responseSize: perfMonitor.metrics.responseSize,
      duration: perfMonitor.metrics.duration,
      averageTimePerRecord: perfMonitor.metrics.averageTimePerRecord,
    };

    for (const [index, vehicle] of vehicles.entries()) {
      const responseItem = response.data.responses[index];
      perfMonitor.logVehicleResponse(index, responseItem);

      //Debug Response (all rows) Log the response for each vehicle for debugging
      //console.log(`Vehicle ${index} Response:`, responseItem);

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
        .input("RowId", sql.Int, vehicle.RowId)
        .input("BatchId", sql.UniqueIdentifier, batchId)
        .input("JobId", sql.UniqueIdentifier, jobId)
        .input("Status", sql.NVarChar, status)
        .input("ErrorMessage", sql.NVarChar, errorMessage).query(`
          UPDATE AllvehiclesTest
          SET BatchId = @BatchId, JobId = @JobId, Status = @Status, Error = @ErrorMessage
          WHERE RowId = @RowId
        `);

      if (status === "Completed") {
        perfMonitor.incrementSuccessCount();
      } else {
        perfMonitor.incrementFailureCount();
      }
      perfMonitor.setLastProcessedIndex(vehicle.RowId);
    }

    perfMonitor.endOperation();

    await pool
      .request()
      .input("BatchID", sql.UniqueIdentifier, batchId)
      .input("StartTime", sql.DateTime, new Date(perfMonitor.metrics.startTime))
      .input("EndTime", sql.DateTime, new Date(perfMonitor.metrics.endTime))
      .input("TotalRecords", sql.Int, vehicles.length)
      .input("SuccessCount", sql.Int, perfMonitor.metrics.successCount)
      .input("FailureCount", sql.Int, perfMonitor.metrics.failureCount)
      .input(
        "LastProcessedIndex",
        sql.Int,
        perfMonitor.metrics.lastProcessedIndex
      )
      .input("Status", sql.NVarChar, result.success ? "Completed" : "Failed")
      .input("ErrorMessage", sql.NVarChar, result.success ? null : result.error)
      .query(`
        INSERT INTO PriorityBatchProcessing (BatchID, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage)
        VALUES (@BatchID, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage)
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

async function processBatches(recordCount: number, startRow: number) {
  const pool = await poolPromise;
  if (!pool) {
    throw new Error("Failed to connect to the database");
  }

  const limit = pLimit(CONCURRENT_BATCHES);

  const vehiclesData = await pool.request().query(`
    SELECT TOP (${recordCount}) RowId, Data
    FROM AllvehiclesTest
    WHERE Status IS NULL AND RowId >= ${startRow}
  `);

  const vehicles = vehiclesData.recordset.map((record: any) => ({
    RowId: record.RowId,
    ...JSON.parse(record.Data),
  }));

  const batchPromises = [];
  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);
    const batchId = uuidv4();
    const jobId = uuidv4();
    batchPromises.push(limit(() => processBatch(batch, batchId, jobId)));
  }

  const results = [];
  for (const batchPromise of batchPromises) {
    results.push(await batchPromise);
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
  }

  return results;
}

export { processBatch, processBatches };
