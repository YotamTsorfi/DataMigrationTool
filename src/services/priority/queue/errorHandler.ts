/**
 * This file contains functions for handling errors during response processing.
 * It includes utilities for logging errors and updating database records with error information.
 */

import { writeToLogFile } from "../../../config/logger";
import { ChildJob } from "../../../types/jobTypes";
import { ErrorBufferService } from "../../../utils/errorBufferService";
import { generateCleanError } from "../../../utils/errorUtils";
import { DatabaseService } from "../../database/databaseService";
import { getChildRecords } from "./childRecordHelper";

/**
 * Logs when a Priority ID field is missing from an API response.
 * Helps identify field mapping issues between the system and Priority.
 *
 * @param recordId - The record ID that was processed
 * @param tableName - The source table name
 * @param fieldName - The expected field name that was missing
 * @param jobId - The job identifier
 */
export function logMissingPriorityField(
  recordId: string | number,
  tableName: string,
  fieldName: string,
  jobId: string
): void {
  try {
    const logEntry = `Missing field in Priority response: Record ID ${recordId} from ${tableName} - Field '${fieldName}' not found in response`;
    writeToLogFile("missing_priority_fields.log", logEntry);
  } catch (loggingError) {
    console.error("Failed to log missing Priority field:", loggingError);
  }
}

/**
 * Logs detailed information about failures detected during response processing.
 * Used to capture API responses that contain business logic errors even when
 * the HTTP request itself was successful.
 *
 * @param response - The API response
 * @param record - The record that failed processing
 * @param error - Error information
 * @param jobId - The job identifier
 */
export function logResponseError(
  response: any,
  record: any,
  error: any,
  jobId: string
): void {
  try {
    const timestamp = new Date().toISOString();
    const recordId = record.RowId || "unknown";
    const errorMessage =
      typeof error === "string"
        ? error
        : error?.message || JSON.stringify(error);
    const statusCode = response?.status || "unknown";

    // Format the log entry
    const logEntry = [
      `[RESPONSE ERROR] [${timestamp}] [JobId: ${jobId}] [RecordId: ${recordId}] [Status: ${statusCode}]`,
      `Error: ${errorMessage}`,
      `Response Body:`,
      JSON.stringify(response?.data, null, 2),
    ].join("\n");

    // Write to a dedicated log file for failed responses
    writeToLogFile("failed_responses.log", logEntry);
  } catch (loggingError) {
    console.error("Failed to log response error:", loggingError);
  }
}

/**
 * Forces database updates with error information when the response processor itself fails.
 * Ensures that database records are updated even in catastrophic failure scenarios.
 *
 * @param records - The records being processed
 * @param error - The error that occurred
 * @param parentTable - The parent table name
 * @param jobId - The job identifier
 * @param batchId - The batch identifier
 * @param childJobs - Child job configurations
 * @param logErrors - Whether to log detailed errors
 */
export async function forceErrorDatabaseUpdates(
  records: any[],
  error: any,
  parentTable: string,
  jobId: string,
  batchId: string,
  childJobs?: ChildJob[],
  logErrors: boolean = false
): Promise<void> {
  console.log(
    `Forcing database updates for ${records.length} records due to processor error`
  );

  const errorMessage = error instanceof Error ? error.message : String(error);

  // Create parent updates
  const parentUpdates = records.map((record) => ({
    RowId: record.RowId,
    BatchId: record.__batchId || batchId,
    JobName: record.__jobType,
    Status: "Failed",
    Error: errorMessage,
    CleanError: generateCleanError(errorMessage),
    JobId: jobId,
    priority_id: null,
    is_new: 1,
    StatusCode: error.status || 500,
  }));

  // Create error logs
  const errorLogs = records.map((record) => ({
    JobName: record.__jobType,
    BatchId: record.__batchId || batchId,
    TableName: record.__tableName || parentTable,
    RowId: record.RowId,
    Error: errorMessage,
    JobId: jobId,
    ErrorStatus: "PROCESSOR_ERROR",
  }));

  // Create child updates if applicable
  const childUpdates: any[] = [];

  if (childJobs && childJobs.length > 0) {
    records.forEach((record) => {
      if (record.childRecords) {
        childJobs.forEach((job) => {
          const childRecords = getChildRecords(
            record,
            job.JobTypeName,
            job.DBTableName
          );

          if (childRecords && Array.isArray(childRecords)) {
            childRecords.forEach((childRecord) => {
              childUpdates.push({
                RowId: childRecord.RowId,
                BatchId: record.__batchId || batchId,
                JobName: record.__jobType,
                Status: "Failed",
                Error: errorMessage,
                CleanError: generateCleanError(errorMessage),
                JobId: jobId,
                priority_id: null,
                is_new: 1,
                tableName: job.DBTableName,
                StatusCode: error.status || 500,
              });
            });
          }
        });
      }
    });
  }

  // Perform database updates
  try {
    if (parentUpdates.length > 0) {
      await DatabaseService.performBulkUpdateWithService(
        parentTable,
        parentUpdates
      );
    }

    // Use error buffer instead of direct insert for error logs
    if (errorLogs.length > 0 && logErrors) {
      ErrorBufferService.getInstance().addErrors(errorLogs);
    }

    if (childUpdates.length > 0) {
      // Group by table name
      const childUpdatesByTable: Record<string, any[]> = {};

      childUpdates.forEach((update) => {
        const tableName = update.tableName;
        delete update.tableName;

        if (!childUpdatesByTable[tableName]) {
          childUpdatesByTable[tableName] = [];
        }
        childUpdatesByTable[tableName].push(update);
      });

      // Update each child table
      for (const [tableName, updates] of Object.entries(childUpdatesByTable)) {
        await DatabaseService.performBulkUpdateWithService(tableName, updates);
      }
    }
  } catch (dbError) {
    console.error("Failed to update database with error information:", dbError);
  }
}
