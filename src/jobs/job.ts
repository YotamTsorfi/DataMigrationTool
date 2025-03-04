import { poolPromise } from '../config/db';
import axios from 'axios';
import { config } from '../config/config';
import PerformanceMonitor from '../utils/performanceMonitor';
import sql from 'mssql';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';

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
const DELAY_BETWEEN_BATCHES = 5000; // דיליי בין השליחות במילישניות

async function processBatch(vehicles: any[]) {
  const pool = await poolPromise;
  if (!pool) {
    throw new Error('Failed to connect to the database');
  }

  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    if (!Array.isArray(vehicles) || vehicles.length === 0) {
      throw new Error('Invalid vehicles data');
    }

    perfMonitor.logRequestMetrics({ vehicles });

    const boundary = `batch_${Date.now()}`;
    let batchBody = '';

    vehicles.forEach((vehicle: any, index: number) => {
      batchBody += `--${boundary}\r\n`;
      batchBody += `Content-Type: application/http\r\n`;
      batchBody += `Content-Transfer-Encoding: binary\r\n\r\n`;
      batchBody += `POST NATF_VEHICLES HTTP/1.1\r\n`;
      batchBody += `Content-Type: application/json\r\n\r\n`;
      batchBody += `${JSON.stringify(vehicle)}\r\n\r\n`;
    });

    batchBody += `--${boundary}--`;

    const response = await axios.post(`${config.priorityBaseUrl}/$batch`, batchBody, {
      headers: {
        'Content-Type': `multipart/mixed;boundary=${boundary}`,
        'Authorization': `Basic ${Buffer.from(`${config.priorityPAT}:${config.priorityPassword}`).toString('base64')}`,
      },
    });

    perfMonitor.logResponseMetrics(response.data, response.status);

    const result: BatchCreateVehiclesResult = {
      success: true,
      message: 'Batch vehicles created successfully',
      vehiclesCount: vehicles.length,
      data: response.data,
      requestSize: perfMonitor.metrics.requestSize,
      responseSize: perfMonitor.metrics.responseSize,
      duration: perfMonitor.metrics.duration,
      averageTimePerRecord: perfMonitor.metrics.averageTimePerRecord,
    };

    await pool.request()
      .input('StartTime', sql.DateTime, new Date(perfMonitor.metrics.startTime))
      .input('EndTime', sql.DateTime, new Date(perfMonitor.metrics.endTime))
      .input('TotalRecords', sql.Int, vehicles.length)
      .input('SuccessCount', sql.Int, result.success ? vehicles.length : 0)
      .input('FailureCount', sql.Int, result.success ? 0 : vehicles.length)
      .input('Status', sql.NVarChar, result.success ? 'Completed' : 'Failed')
      .input('ErrorMessage', sql.NVarChar, result.success ? null : result.error)
      .query(`
        INSERT INTO PriorityBatchProcessing (StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, Status, ErrorMessage)
        VALUES (@StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @Status, @ErrorMessage)
      `);

    perfMonitor.endOperation();
    return result;
  } catch (error) {
    perfMonitor.logError(error);
    console.error('Error in processBatch:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function processBatches() {
  const dataDir = path.join(__dirname, "../data");
  const fileNames = fs.readdirSync(dataDir).filter(file => file.startsWith('vehicles_batch_'));
  const filePaths = fileNames.map(fileName => path.join(dataDir, fileName));

  const limit = pLimit(CONCURRENT_BATCHES);

  const batchPromises = filePaths.map(filePath => {
    const vehicles = require(filePath);
    const batches = [];

    for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
      const batch = vehicles.slice(i, i + BATCH_SIZE);
      batches.push(limit(() => processBatch(batch)));
    }

    return batches;
  }).flat();

  const results = [];
  for (const batchPromise of batchPromises) {
    results.push(await batchPromise);
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
  }

  return results;
}

export { processBatch, processBatches };
