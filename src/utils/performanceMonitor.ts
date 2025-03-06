// src/utils/performanceMonitor.ts

import { performance } from 'perf_hooks';
import { writeToLogFile } from "../config/logger";
import moment from "moment-timezone";

interface PerformanceMetrics {
  startTime: number;
  endTime: number;
  duration: number;
  requestSize: number;
  responseSize: number;
  success: boolean;
  statusCode?: number;
  errorType?: string;
  recordCount: number;
  averageTimePerRecord?: string;
  successCount: number;
  failureCount: number;
  lastProcessedIndex: number;
}

class PerformanceMonitor {
  public metrics: PerformanceMetrics;
  private requestData: any;

  constructor() {
    this.metrics = {
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      requestSize: 0,
      responseSize: 0,
      success: false,
      recordCount: 0,
      successCount: 0,
      failureCount: 0,
      lastProcessedIndex: 0,
    };
    this.requestData = null;
  }

  private formatDate(date: Date): string {
    return moment(date).tz("Asia/Jerusalem").format("DD-MM-YYYY HH:mm:ss");
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  startOperation() {
    this.metrics.startTime = Date.now();
    console.log(`Operation started at: ${this.formatDate(new Date())}`);
    return performance.now();
  }

  logRequestMetrics(requestData: any) {
    try {
      this.requestData = requestData;
      const requestString = JSON.stringify(requestData);
      this.metrics.requestSize = Buffer.byteLength(requestString, "utf8");
      this.metrics.recordCount = Array.isArray(requestData)
        ? requestData.length
        : 0;

      console.log("Request Metrics:", {
        recordCount: this.metrics.recordCount,
        size: this.formatSize(this.metrics.requestSize),
        timestamp: this.formatDate(new Date()),
      });
    } catch (error) {
      console.error("Error measuring request size:", error);
      this.metrics.requestSize = 0;
      this.metrics.recordCount = 0;
    }
  }

  logResponseMetrics(responseData: any, statusCode: number) {
    try {
      const responseString = JSON.stringify(responseData);
      this.metrics.responseSize = Buffer.byteLength(responseString, "utf8");
      this.metrics.statusCode = statusCode;
      this.metrics.success = statusCode >= 200 && statusCode < 300;

      console.log("Response Metrics:", {
        size: this.formatSize(this.metrics.responseSize),
        status: statusCode,
        success: this.metrics.success,
        timestamp: this.formatDate(new Date()),
      });
    } catch (error) {
      console.error("Error measuring response:", error);
      this.metrics.responseSize = 0;
    }
  }

  logError(error: any) {
    if (error.response) {
      this.metrics.statusCode = error.response.status;
      this.metrics.errorType = "AxiosError";
    } else if (error instanceof Error) {
      this.metrics.errorType = error.name;
    } else {
      this.metrics.errorType = "Unknown";
    }
    this.metrics.success = false;

    console.error("Error Metrics:", {
      type: this.metrics.errorType,
      status: this.metrics.statusCode,
      timestamp: this.formatDate(new Date()),
    });
  }

  endOperation() {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;

    const performanceLog = {
      timestamp: this.formatDate(new Date()),
      operation: "batchVehicles",
      metrics: {
        totalDuration: `${this.metrics.duration}ms`,
        requestSize: this.formatSize(this.metrics.requestSize),
        responseSize: this.formatSize(this.metrics.responseSize),
        recordCount: this.metrics.recordCount,
        success: this.metrics.success,
        statusCode: this.metrics.statusCode,
        errorType: this.metrics.errorType,
        averageTimePerRecord:
          this.metrics.recordCount > 0
            ? `${(this.metrics.duration / this.metrics.recordCount).toFixed(2)}ms`
            : "N/A",
      },
    };

    console.log("Performance Summary:", performanceLog);
    writeToLogFile("performance.log", JSON.stringify(performanceLog));
  }

  incrementSuccessCount() {
    this.metrics.successCount += 1;
  }

  incrementFailureCount() {
    this.metrics.failureCount += 1;
  }

  setLastProcessedIndex(index: number) {
    this.metrics.lastProcessedIndex = index;
  }

  logVehicleResponse(index: number, response: any) {
    console.log(`Vehicle ${index} Response:`, {
      status: response.status,
      data: response.data,
      timestamp: this.formatDate(new Date()),
    });
  }

  static logServerMetrics() {
    const memoryUsage = process.memoryUsage();
    const metrics = {
      timestamp: new PerformanceMonitor().formatDate(new Date()),
      operation: "serverStatus",
      metrics: {
        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB`,
      },
    };

    writeToLogFile("performance.log", JSON.stringify(metrics));
  }
}

export default PerformanceMonitor;