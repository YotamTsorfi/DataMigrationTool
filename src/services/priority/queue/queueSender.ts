/**
 * This module provides a specialized service for sending individual parent-child records to Priority API.
 * It works with the queue processor to handle one record at a time with proper error handling and retries.
 */
import { writeToLogFile } from "../../../config/logger";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { configService } from "../../../config/configService";
import PerformanceMonitor from "../../../utils/performanceMonitor";
import { processParentChildResponse } from "./responseProcessor";
import { ChildJob, ParentChildQueueResult } from "../../../types/jobTypes";
// import { ErrorBufferService } from "../utils/errorBufferService";

/**
 * Logs detailed information about failed API requests including the complete request body.
 * This helps with debugging by capturing exactly what was sent when an error occurred.
 *
 * @param record - The record that failed processing
 * @param error - The error that occurred
 * @param requestBody - The complete request body that was sent to the API
 * @param jobId - The job identifier
 */
const logFailedRequestBody = (
  record: any,
  error: any,
  requestBody: any,
  jobId: string
): void => {
  try {
    // Create a detailed error message
    const timestamp = new Date().toISOString();
    const recordId = record.RowId || "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode = error?.response?.status || "unknown";

    // Format the log entry
    const logEntry = [
      `[ERROR] [${timestamp}] [JobId: ${jobId}] [RecordId: ${recordId}] [Status: ${statusCode}]`,
      `Error: ${errorMessage}`,
      `Request Body:`,
      JSON.stringify(requestBody, null, 2),
    ].join("\n");

    // Write to a dedicated log file for failed requests
    writeToLogFile("failed_requests.log", logEntry);
  } catch (loggingError) {
    // Ensure logging errors don't disrupt processing
    console.error("Failed to log request body:", loggingError);
  }
};

/**
 * Sends a single parent-child record to Priority API and processes the response
 * Works with the QueueProcessor for individual record processing
 *
 * @param record - Single parent record with its child records
 * @param jobType - Type of job being processed
 * @param tableName - Source database table name
 * @param priorityScreenName - Target Priority screen name
 * @param jobId - Unique job identifier
 * @param priorityIdField - Field name for Priority ID
 * @param childTableNames - Array of child table names
 * @param childJobs - Child job definitions
 * @param logErrors - Whether to log detailed errors
 * @param updateBatchTable - Whether to update batch tracking table
 */
export async function sendParentChildQueue(
  record: any,
  jobType: string,
  tableName: string,
  priorityScreenName: string,
  jobId: string,
  priorityIdField?: string,
  childTableNames?: string[],
  childJobs?: ChildJob[],
  logErrors: boolean = false,
  updateBatchTable: boolean = false
): Promise<ParentChildQueueResult> {
  // Create a unique batch ID for this single record
  const batchId = uuidv4();
  const config = await configService.getConfig();

  // Initialize performance monitoring
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    if (!record) {
      throw new Error("Invalid record data");
    }

    // Create enriched record with metadata
    const enrichedRecord = {
      ...record,
      __batchId: batchId,
      __jobType: jobType,
      __tableName: tableName,
      __jobId: jobId,
      __priorityScreenName: priorityScreenName,
    };

    // Clean record for API (remove internal fields starting with __)
    const cleanRecordForApi = { ...enrichedRecord };
    Object.keys(cleanRecordForApi).forEach((key) => {
      if (key.startsWith("__")) {
        delete cleanRecordForApi[key];
      }
    });

    // Remove additional internal fields that shouldn't be sent to the API
    // Remove internal fields that don't start with __ but are still internal
    const internalFields = ["childRecords", "RowId"];
    internalFields.forEach((field) => {
      if (field in cleanRecordForApi) {
        delete cleanRecordForApi[field];
      }
    });

    // Clean existing subform data that was already formatted by the fetcher
    Object.keys(cleanRecordForApi).forEach((key) => {
      if (key.endsWith("_SUBFORM")) {
        // This subform was already created by the fetcher
        if (Array.isArray(cleanRecordForApi[key])) {
          // Clean array elements (HasSiblings=true case)
          cleanRecordForApi[key] = cleanRecordForApi[key].map((item) => {
            // Remove internal fields from each item
            const cleanItem = { ...item };
            Object.keys(cleanItem).forEach((itemKey) => {
              if (
                itemKey.startsWith("__") ||
                internalFields.includes(itemKey)
              ) {
                delete cleanItem[itemKey];
              }
            });
            return cleanItem;
          });
        } else if (cleanRecordForApi[key]) {
          // Clean single object (HasSiblings=false case)
          const cleanItem = { ...cleanRecordForApi[key] };
          Object.keys(cleanItem).forEach((itemKey) => {
            if (itemKey.startsWith("__") || internalFields.includes(itemKey)) {
              delete cleanItem[itemKey];
            }
          });
          cleanRecordForApi[key] = cleanItem;
        }
      }
    });

    // Remove childRecords entirely as we don't need to send it
    delete cleanRecordForApi.childRecords;

    // Debug log the request data
    // console.log(
    //   `Sending record to Priority: ${priorityScreenName}, RowId: ${record.RowId}`
    // );

    // Measure request performance
    perfMonitor.startBatchBuild();

    // Prepare API request
    // Check if the base URL ends with a slash and the screen name starts with one
    let baseUrl = config.PRIORITY_BASE_URL;
    if (!baseUrl.endsWith("/")) baseUrl += "/";
    let company = config.PRIORITY_COMPANY;
    if (company.endsWith("/")) company = company.slice(0, -1);

    // Construct the full URL for the request
    const url = `${baseUrl}${company}/${priorityScreenName}`;

    // Create headers with authentication

    //TODO - Add Debugging headers
    // "X-App-Trace"="1"
    // const headers = {
    //   "Content-Type": "application/json",
    //   Accept: "application/json",
    //   "OData-Version": "4.0",
    //   Authorization: `Basic ${Buffer.from(`${config.PRIORITY_PAT}:${config.PRIORITY_PASSWORD}`).toString("base64")}`,
    //   "X-App-Trace": "1",
    // };
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "OData-Version": "4.0",
      Authorization: `Basic ${Buffer.from(`${config.PRIORITY_PAT}:${config.PRIORITY_PASSWORD}`).toString("base64")}`,
    };

    perfMonitor.endBatchBuild();
    // console.log("DEBUG - REQUEST URL:", url);
    // console.log(
    //   "DEBUG - REQUEST PAYLOAD:",
    //   JSON.stringify(cleanRecordForApi, null, 2)
    // );
    // console.log(
    //   "DEBUG - REQUEST HEADERS:",
    //   JSON.stringify({ ...headers, Authorization: "[REDACTED]" }, null, 2)
    // );

    // Send request to Priority API
    // Send request to Priority API
    perfMonitor.startRequest();
    let response;
    try {
      // Send direct JSON request instead of batch format
      response = await axios.post(url, cleanRecordForApi, {
        headers,
        timeout: config.TIME_OUT || 240000,
      });
      perfMonitor.endRequest();

      // Convert successful response to a format compatible with processParentChildResponse
      response = {
        status: response.status,
        data: {
          responses: [
            {
              status: response.status,
              body: response.data,
              error: null,
            },
          ],
        },
      };
    } catch (error) {
      perfMonitor.endRequest(); // Ensure performance timing ends properly
      perfMonitor.logError(error);

      // Log the failed request body for debugging
      logFailedRequestBody(record, error, cleanRecordForApi, jobId);

      // Extract error details efficiently without verbose logging
      const statusCode =
        axios.isAxiosError(error) && error.response
          ? error.response.status
          : 500;
      let errorMessage = error instanceof Error ? error.message : String(error);
      let errorData = null;

      // Handle different error response formats (JSON, XML, HTML) without excessive logging
      if (axios.isAxiosError(error) && error.response?.data) {
        errorData = error.response.data;

        // Extract specific error message from Priority API's various error formats
        if (errorData?.FORM?.InterfaceErrors?.text) {
          // Priority-specific error format
          errorMessage = errorData.FORM.InterfaceErrors.text;

          // Only log critical errors (not 400 Bad Request which are often expected)
          if (statusCode >= 500) {
            console.error(`Priority API server error (${statusCode})`);
          }
        } else if (errorData.error?.message) {
          // Standard JSON error format
          errorMessage = errorData.error.message;

          // Only log critical errors
          if (statusCode >= 500) {
            console.error(`Priority API error (${statusCode})`);
          }
        } else if (typeof errorData === "string") {
          // HTML or plain text error - no console log
        } else {
          // Other error formats - minimal logging for server errors only
          if (statusCode >= 500) {
            console.error(`Priority API server error: ${statusCode}`);
          }
        }
      } else if (!axios.isAxiosError(error)) {
        // Only log non-Axios errors which might indicate system issues
        console.error(`Network or system error`);
      }

      // Always create a properly structured response for downstream processing
      // This ensures processParentChildResponse can handle all error types consistently
      response = {
        status: statusCode,
        data: {
          responses: [
            {
              status: statusCode,
              body: errorData,
              error: errorMessage,
            },
          ],
          error: errorData, // Keep this for backward compatibility
        },
      };
    }
    // Process response with the existing processor
    const result = await processParentChildResponse(
      response,
      [enrichedRecord], // We still pass as array here for compatibility
      perfMonitor,
      tableName,
      batchId,
      jobType,
      jobId,
      priorityIdField,
      childJobs,
      logErrors,
      updateBatchTable,
      cleanRecordForApi
    );

    // Additional error logging for business logic errors
    // These are cases where the HTTP request succeeded but the business logic failed
    if (!result.success) {
      logFailedRequestBody(
        record,
        { message: result.message },
        cleanRecordForApi,
        jobId
      );
    }

    // Extract priority ID if available
    let priorityId = null;
    if (
      result.success &&
      response?.data?.responses &&
      response.data.responses[0]?.body &&
      priorityIdField
    ) {
      try {
        const responseBody = response.data.responses[0].body;
        if (responseBody && responseBody[priorityIdField] !== undefined) {
          priorityId = responseBody[priorityIdField];
        }
      } catch (error) {
        console.warn("Error extracting priority ID:", error);
      }
    }

    // Use optional chaining to safely access the error property
    const errorData =
      response?.data?.error || response?.data?.responses?.[0]?.error;

    // Return result in format compatible with queue processor
    return {
      success: result.success,
      successCount: result.successCount,
      failureCount: result.failureCount,
      error: result.success ? undefined : result.message,
      status: response.status,
      errorData, // Use the safely extracted error data
      priorityId,
      duration: perfMonitor.metrics.duration,
    };
  } catch (error) {
    console.error("Fatal error in sendParentChildQueue:", error);

    // Log the failed request for unexpected errors
    let reconstructedPayload;
    try {
      // We need to reconstruct what the request body would have been
      const reconstructedPayload = { ...record };
      // Remove internal fields
      Object.keys(reconstructedPayload).forEach((key) => {
        if (key.startsWith("__") || ["childRecords", "RowId"].includes(key)) {
          delete reconstructedPayload[key];
        }
      });

      // Log the error with the best approximation of the request body
      logFailedRequestBody(record, error, reconstructedPayload, jobId);
    } catch (loggingError) {
      console.error("Failed to log error request body:", loggingError);
      reconstructedPayload = {};
    }

    // Handle error by creating error records
    try {
      await processParentChildResponse(
        {
          status: 500,
          data: {
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
          },
        },
        [record],
        perfMonitor,
        tableName,
        batchId,
        jobType,
        jobId,
        priorityIdField,
        childJobs,
        logErrors,
        updateBatchTable,
        reconstructedPayload
      );
    } catch (updateError) {
      console.error("Failed to update error records:", updateError);
    }

    return {
      success: false,
      successCount: 0,
      failureCount: 1,
      error: error instanceof Error ? error.message : String(error),
      status: 500,
    };
  }
}
