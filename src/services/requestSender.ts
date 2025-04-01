import axios from "axios";
import http from "http";
import https from "https";
import { config } from "../config/config";
import PerformanceMonitor from "../utils/performanceMonitor";
import { formatAxiosError, createCleanError } from "../utils/errorHandler";

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

/**
 * Sends a batch request to the Priority API
 */
export async function sendBatchRequest(
  batchBody: string,
  headers: Record<string, string>
): Promise<any> {
  const maxRetries = 3;
  let retryCount = 0;
  let lastError: any;

  while (retryCount < maxRetries) {
    try {
      // Add timeout parameter explicitly
      const response = await axios.post(
        `${config.priorityDEVBaseUrl}/$batch`,
        batchBody,
        {
          headers,
          timeout: 30000, // 30 seconds timeout
          httpAgent,
          httpsAgent,
        }
      );
      return response;
    } catch (error: any) {
      lastError = error;

      // Use formatAxiosError to get a clean error message for logging
      const errorMessage = formatAxiosError(error);

      // Check specifically for 429 Too Many Requests
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        // Get retry-after header if available, or use exponential backoff with jitter
        const retryAfter = error.response.headers["retry-after"];
        let delayMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : 1000 * Math.pow(2, retryCount);

        // Add jitter to prevent all retries happening simultaneously
        delayMs += Math.floor(Math.random() * 1000);

        retryCount++;
        console.log(
          `Rate limit exceeded (429). Retry attempt ${retryCount} after ${delayMs}ms delay. ${errorMessage}`
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // Only retry on network errors and 5xx server errors
      if (
        axios.isAxiosError(error) &&
        (error.code === "ETIMEDOUT" ||
          error.code === "ECONNABORTED" ||
          error.code === "ECONNREFUSED" ||
          (error.response?.status && error.response.status >= 500))
      ) {
        retryCount++;
        console.log(`Retry attempt ${retryCount} after error: ${errorMessage}`);

        // Exponential backoff
        const delay = 1000 * Math.pow(2, retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // For other errors, don't retry
        break;
      }
    }
  }

  // Use the new createCleanError function instead of manual error creation
  throw createCleanError(lastError, "Priority Batch Request");
}

/**
 * Processes the response from the Priority API
 */
export function processApiResponse(
  response: any,
  rows: any[]
): {
  updateRows: any[];
  errorRows: any[];
  successCount: number;
  failureCount: number;
  lastProcessedIndex: number;
  sentToPriority: boolean;
} {
  const updateRows: any[] = [];
  const errorRows: any[] = [];
  let successCount = 0;
  let failureCount = 0;
  let lastProcessedIndex = 0;

  // check if the response has a 'responses' array
  const sentToPriority = !!(
    response &&
    response.data &&
    response.data.responses
  );

  //   console.log("===== PROCESSING API RESPONSE =====");
  //   console.log("Processing", rows.length, "rows against response");

  // Process all response items
  rows.forEach((row, index) => {
    const responseItem = response.data.responses
      ? response.data.responses[index]
      : null;

    // Debug: Log individual record processing
    // console.log(`Processing row ${index} (RowId: ${row.RowId}):`);

    if (!responseItem) {
      console.error(`No response item found for index ${index}`);
      failureCount++;

      // Add to update collection as failed
      updateRows.push({
        RowId: row.RowId,
        BatchId: row.__batchId,
        JobName: row.__jobType,
        Status: "Failed",
        ErrorMessage: "No response item found",
        JobId: row.__jobId,
      });

      // Add to error collection
      errorRows.push({
        JobName: row.__jobType,
        BatchId: row.__batchId,
        TableName: row.__tableName,
        RowId: row.RowId,
        Error: "No response item found",
        JobId: row.__jobId,
      });

      lastProcessedIndex = row.RowId;
      return;
    }

    // Consider any response with status code as success - the fact we got a response means
    // the API request was processed (even with business logic errors)
    const status = responseItem.status < 400 ? "Completed" : "Failed";

    // Check for actual error messages from the API to log them, but don't change status
    const errorMessage =
      responseItem.status >= 400
        ? JSON.stringify(responseItem?.body?.FORM?.InterfaceErrors)
        : null;

    if (errorMessage) {
      console.log(`  Error message in API response: ${errorMessage}`);
    }

    // Update tracking metrics based on status
    if (status === "Completed") {
      successCount++;
    } else {
      failureCount++;

      // Add to error collection for ALL failed responses regardless of error message
      errorRows.push({
        JobName: row.__jobType,
        BatchId: row.__batchId,
        TableName: row.__tableName,
        RowId: row.RowId,
        Error: errorMessage || "Failed without specific error message",
        JobId: row.__jobId,
      });
    }
    // Add to update collection - always add status information
    updateRows.push({
      RowId: row.RowId,
      BatchId: row.__batchId,
      JobName: row.__jobType,
      Status: status,
      ErrorMessage: errorMessage,
      JobId: row.__jobId,
    });

    lastProcessedIndex = row.RowId;
  });

  // console.log(`Processing complete. Success: ${successCount}, Failures: ${failureCount}`);
  // console.log("===================================");

  return {
    updateRows,
    errorRows,
    successCount,
    failureCount,
    lastProcessedIndex,
    sentToPriority,
  };
}

/**
 * Measures the performance of a batch request
 */
export function measureRequestPerformance(
  rows: any[],
  perfMonitor: PerformanceMonitor
): void {
  perfMonitor.logRequestMetrics(rows);
}

/**
 * Measures the performance of a batch response
 */
export function measureResponsePerformance(
  response: any,
  perfMonitor: PerformanceMonitor
): void {
  perfMonitor.logResponseMetrics(response.data, response.status);
}
