import axios from "axios";
import http from "http";
import https from "https";
import { config } from "../config/config";
import PerformanceMonitor from "../utils/performanceMonitor";

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
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startRequest();

  try {
    // console.log("Sending batch request to Priority API...");

    const response = await axios.post(
      `${config.priorityDEVBaseUrl}/$batch`,
      batchBody,
      {
        headers,
        httpAgent: httpAgent,
        httpsAgent: httpsAgent,
      }
    );

    perfMonitor.endRequest();

    // console.log(`Batch request completed with status ${response.status}`);

    // Debug: Log detailed response information
    // console.log("===== RESPONSE DETAILS =====");
    // console.log("Status:", response.status);
    // console.log("Content Type:", response.headers['content-type']);

    // Check if the response has a 'responses' array
    if (response.data && response.data.responses) {
      //   console.log("Response contains", response.data.responses.length, "items");
      //   console.log("First response item:", JSON.stringify(response.data.responses[0]).substring(0, 200));

      // Count success vs failures
      const successCount = response.data.responses.filter(
        (r: any) => r.status >= 200 && r.status < 300
      ).length;
      const failureCount = response.data.responses.length - successCount;
      // console.log(`Success: ${successCount}, Failures: ${failureCount}`);

      // If there are failures, show the first failure
      if (failureCount > 0) {
        const firstFailure = response.data.responses.find(
          (r: any) => r.status >= 300
        );
        if (firstFailure) {
          console.log(
            "Sample failure:",
            JSON.stringify(firstFailure).substring(0, 300)
          );
        }
      }
    } else {
      // console.log(
      //   "Response data structure:",
      //   JSON.stringify(response.data).substring(0, 300)
      // );
    }
    // console.log("=============================");

    return response;
  } catch (error) {
    perfMonitor.logError(error);
    console.error("Error sending batch request:", error);
    throw error;
  }
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

    const status =
      responseItem && responseItem.status >= 200 && responseItem.status < 300
        ? "Completed"
        : "Failed";

    // console.log(`  Status: ${status}, Response status: ${responseItem.status}`);

    const errorMessage =
      status === "Failed"
        ? JSON.stringify(responseItem?.body?.FORM?.InterfaceErrors)
        : null;

    if (errorMessage) {
      console.log(`  Error message: ${errorMessage}`);
    }

    // Add to update collection
    updateRows.push({
      RowId: row.RowId,
      BatchId: row.__batchId,
      JobName: row.__jobType,
      Status: status,
      ErrorMessage: errorMessage,
      JobId: row.__jobId,
    });

    // Track metrics
    if (status === "Completed") {
      successCount++;
    } else {
      failureCount++;

      // Add to error collection if failed
      errorRows.push({
        JobName: row.__jobType,
        BatchId: row.__batchId,
        TableName: row.__tableName,
        RowId: row.RowId,
        Error: errorMessage || "",
        JobId: row.__jobId,
      });
    }

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
