import { performance } from "perf_hooks";
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
  dbFetchTime?: number;
  dbUpdateTime?: number;
  batchBuildTime?: number;
  queueBuildTime?: number; // This property was in the comment but missing in actual interface
  requestTime?: number;
}

class PerformanceMonitor {
  public metrics: PerformanceMetrics;
  private requestData: any;
  private dbFetchStartTime: number = 0;
  private dbUpdateStartTime: number = 0;
  private batchBuildStartTime: number = 0;
  private requestStartTime: number = 0;
  private queueBuildStartTime: number = 0; // Add tracking for queue building time

  private externalDbFetchTime: number | undefined;
  private externalDbUpdateTime: number | undefined;

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
    this.externalDbFetchTime = undefined;
    this.externalDbUpdateTime = undefined;
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

  private formatTime(ms: number | undefined): string {
    if (ms === undefined) return "0ms";
    return `${ms.toFixed(2)}ms`;
  }

  startOperation() {
    this.metrics.startTime = Date.now();
    // console.log(`Operation started at: ${this.formatDate(new Date())}`);
    return performance.now();
  }

  startDbFetch() {
    this.dbFetchStartTime = performance.now();
    // console.log(`DB fetch started at: ${this.formatDate(new Date())}`);
  }

  endDbFetch() {
    if (this.dbFetchStartTime === 0) return;
    this.metrics.dbFetchTime = performance.now() - this.dbFetchStartTime;
    // console.log(
    //   `DB fetch completed in: ${this.formatTime(this.metrics.dbFetchTime)}`
    // );
    this.dbFetchStartTime = 0; // Reset timer
  }

  // Add method to set DB fetch time from external measurements
  setDbFetchTime(timeMs: number) {
    this.externalDbFetchTime = timeMs;
    // console.log(`External DB fetch time set: ${this.formatTime(timeMs)}`);
  }

  startBatchBuild() {
    this.batchBuildStartTime = performance.now();
    // console.log(`Batch build started at: ${this.formatDate(new Date())}`);
  }

  endBatchBuild() {
    if (this.batchBuildStartTime === 0) return;
    this.metrics.batchBuildTime = performance.now() - this.batchBuildStartTime;
    // console.log(
    //   `Batch build completed in: ${this.formatTime(this.metrics.batchBuildTime)}`
    // );
    this.batchBuildStartTime = 0; // Reset timer
  }

  startRequest() {
    this.requestStartTime = performance.now();
    // console.log(`API request started at: ${this.formatDate(new Date())}`);
  }

  endRequest() {
    if (this.requestStartTime === 0) return;
    this.metrics.requestTime = performance.now() - this.requestStartTime;
    // console.log(
    //   `API request completed in: ${this.formatTime(this.metrics.requestTime)}`
    // );
    this.requestStartTime = 0; // Reset timer
  }

  startQueueBuild() {
    this.queueBuildStartTime = performance.now();
    // console.log(`Queue build started at: ${this.formatDate(new Date())}`);
  }

  endQueueBuild() {
    if (this.queueBuildStartTime === 0) return;
    this.metrics.queueBuildTime = performance.now() - this.queueBuildStartTime;
    // console.log(
    //   `Queue build completed in: ${this.formatTime(this.metrics.queueBuildTime)}`
    // );
    this.queueBuildStartTime = 0; // Reset timer
  }

  logRequestMetrics(requestData: any) {
    try {
      this.requestData = requestData;
      const requestString = JSON.stringify(requestData);
      this.metrics.requestSize = Buffer.byteLength(requestString, "utf8");
      this.metrics.recordCount = Array.isArray(requestData)
        ? requestData.length
        : 0;

      // console.log("Request Metrics:", {
      //   recordCount: this.metrics.recordCount,
      //   size: this.formatSize(this.metrics.requestSize),
      //   timestamp: this.formatDate(new Date()),
      // });
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

      // console.log("Response Metrics:", {
      //   size: this.formatSize(this.metrics.responseSize),
      //   status: statusCode,
      //   success: this.metrics.success,
      //   timestamp: this.formatDate(new Date()),
      // });
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

    // Don't automatically set success to false - let the calling code determine success/failure
    // based on context (whether API received the request or not)
    // this.metrics.success = false;

    console.error("Error Metrics:", {
      type: this.metrics.errorType,
      status: this.metrics.statusCode,
      timestamp: this.formatDate(new Date()),
    });
  }

  startDbUpdate() {
    this.dbUpdateStartTime = performance.now();
    // console.log(`DB update started at: ${this.formatDate(new Date())}`);
  }

  endDbUpdate() {
    if (this.dbUpdateStartTime === 0) return;
    this.metrics.dbUpdateTime = performance.now() - this.dbUpdateStartTime;
    // console.log(
    //   `DB update completed in: ${this.formatTime(this.metrics.dbUpdateTime)}`
    // );
    this.dbUpdateStartTime = 0; // Reset timer
  }

  // Add method to set DB update time from external measurements
  setDbUpdateTime(timeMs: number) {
    this.externalDbUpdateTime = timeMs;
    // console.log(`External DB update time set: ${this.formatTime(timeMs)}`);
  }

  endOperation() {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;

    // Use external DB fetch time if it was set
    if (
      this.externalDbFetchTime !== undefined &&
      this.metrics.dbFetchTime === undefined
    ) {
      this.metrics.dbFetchTime = this.externalDbFetchTime;
    }

    // Use external DB update time if it was set
    if (
      this.externalDbUpdateTime !== undefined &&
      this.metrics.dbUpdateTime === undefined
    ) {
      this.metrics.dbUpdateTime = this.externalDbUpdateTime;
    }

    const performanceLog = {
      timestamp: this.formatDate(new Date()),
      operation: "batchProcessing",
      metrics: {
        totalDuration: this.formatTime(this.metrics.duration),
        requestSize: this.formatSize(this.metrics.requestSize),
        responseSize: this.formatSize(this.metrics.responseSize),
        recordCount: this.metrics.recordCount,
        success: this.metrics.success,
        statusCode: this.metrics.statusCode,
        errorType: this.metrics.errorType,
        averageTimePerRecord:
          this.metrics.recordCount > 0
            ? this.formatTime(this.metrics.duration / this.metrics.recordCount)
            : "N/A",
        dbFetchTime: this.formatTime(this.metrics.dbFetchTime),
        dbUpdateTime: this.formatTime(this.metrics.dbUpdateTime), // Add DB update time to logs
        batchBuildTime: this.formatTime(this.metrics.batchBuildTime),
        requestTime: this.formatTime(this.metrics.requestTime),
        queueBuildTime: this.formatTime(this.metrics.queueBuildTime), // Add this property
      },
    };

    // console.log("Performance Summary:", performanceLog);
    // writeToLogFile("performance.log", JSON.stringify(performanceLog));
  }

  getFormattedMetrics() {
    return {
      totalDuration: this.formatTime(this.metrics.duration),
      dbFetchTime: this.formatTime(
        this.metrics.dbFetchTime || this.externalDbFetchTime
      ),
      dbUpdateTime: this.formatTime(
        this.metrics.dbUpdateTime || this.externalDbUpdateTime
      ), // Add DB update time
      batchBuildTime: this.formatTime(this.metrics.batchBuildTime),
      queueBuildTime: this.formatTime(this.metrics.queueBuildTime), // Add this property
      requestTime: this.formatTime(this.metrics.requestTime),
      averageTimePerRecord:
        this.metrics.recordCount > 0
          ? this.formatTime(this.metrics.duration / this.metrics.recordCount)
          : "N/A",
    };
  }

  incrementSuccessCount() {
    this.metrics.successCount += 1;
  }

  incrementFailureCount() {
    this.metrics.failureCount += 1;
  }

  resetTimer(timerName: string) {
    switch (timerName) {
      case "dbFetch":
        this.dbFetchStartTime = 0;
        break;
      case "dbUpdate":
        this.dbUpdateStartTime = 0;
        break;
      case "batchBuild":
        this.batchBuildStartTime = 0;
        break;
      case "request":
        this.requestStartTime = 0;
        break;
      case "queueBuild":
        this.queueBuildStartTime = 0;
        break;
      case "all":
        this.dbFetchStartTime = 0;
        this.dbUpdateStartTime = 0;
        this.batchBuildStartTime = 0;
        this.requestStartTime = 0;
        this.queueBuildStartTime = 0;
        break;
      default:
        break;
    }
  }

  setLastProcessedIndex(index: number) {
    this.metrics.lastProcessedIndex = index;
  }

  logResponse(index: number, response: any) {
    let errorMessage = null;
    if (response.status >= 400) {
      if (
        response.body &&
        response.body.FORM &&
        response.body.FORM.InterfaceErrors
      ) {
        errorMessage = response.body.FORM.InterfaceErrors;
      } else {
        errorMessage = "Unknown error";
      }
    }

    console.log(`row ${index} Response:`, {
      status: response.status,
      data: response.data,
      error: errorMessage,
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

    // writeToLogFile("performance.log", JSON.stringify(metrics));
  }
}

export default PerformanceMonitor;
