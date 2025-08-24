import { writeToLogFile } from "../config/logger";
import PerformanceMonitor from "../utils/performanceMonitor";
import { measureResponsePerformance } from "../services/requestSender";
import {
  performBulkUpdateWithService,
  recordBatchProcessing,
} from "../services/dataService";
import { ChildJob } from "../jobs/jobParentAndChilds";
import { ErrorBufferService } from "../utils/errorBufferService";

//-------------------------------------------------------------------------
export interface ProcessResponseResult {
  success: boolean;
  message: string;
  successCount: number;
  failureCount: number;
  responseCount?: number;
  averageTimePerRecord: string;
  performanceMetrics: {
    dbFetchTime: string;
    dbUpdateTime: string;
    batchBuildTime: string;
    requestTime: string;
    totalDuration: string;
  };
}

/**
 * Logs the full response body when a critical component like a subform key is missing.
 * This helps with debugging API response structure issues.
 *
 * @param subformKey - The missing subform key that triggered the logging
 * @param responseBody - The full response body to log
 * @param childJob - Information about the child job for context
 * @param recordId - The record ID being processed
 */
function logMissingSubformResponse(
  subformKey: string,
  responseBody: any,
  childJob: ChildJob,
  recordId: string | number
): void {
  try {
    // Create a meaningful filename with timestamp for uniqueness
    const timestamp = new Date().getTime();
    const filename = `missing_subform_${recordId}.log`;

    // Format the log data with important context information
    const logData = [
      `[MISSING SUBFORM KEY ERROR]`,
      `Record ID: ${recordId}`,
      `Missing Subform Key: ${subformKey}`,
      `Child Job Type: ${childJob.JobTypeName}`,
      `Child Job Table: ${childJob.DBTableName}`,
      `Child Job Screen: ${childJob.ScreenName}`,
      `Response Body:`,
      JSON.stringify(responseBody, null, 2),
    ].join("\n");

    // Write to log file
    writeToLogFile(filename, logData);

    // Also log to console in a more compact form
    console.log(
      `Subform key ${subformKey} not found in response - logged to ${filename}`
    );
  } catch (loggingError) {
    console.error("Failed to log missing subform response:", loggingError);
  }
}
/**
 * Generic function to extract Priority ID from any response
 * Works with direct fields, AU fields, and compound patterns
 */
function extractPriorityId(
  responseBody: any,
  idFieldName: string
): string | null {
  // First try direct field access
  if (responseBody && responseBody[idFieldName] !== undefined) {
    const idValue = responseBody[idFieldName];
    return idValue !== null && idValue !== undefined ? String(idValue) : null;
  }

  // Then try special AU fields which might contain the ID
  for (const key of Object.keys(responseBody)) {
    if (key === idFieldName || key.includes("_AU")) {
      const value = responseBody[key];
      if (typeof value === "string" && value.includes("=")) {
        // Extract from pattern like "(FIELDNAME='value')"
        const match = value.match(/'([^']+)'/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
  }

  // Try to find ID patterns in other fields
  for (const key of Object.keys(responseBody)) {
    if (responseBody[key] && typeof responseBody[key] === "string") {
      // Look for typical ID patterns in any field
      const idMatch = responseBody[key].match(/\([A-Z]+=(['"])([^'"]+)\1\)/);
      if (idMatch && idMatch[2]) {
        return idMatch[0];
      }
    }
  }

  return null;
}

/**
 * Extracts the Priority ID for a child record from the API response.
 * Handles various formats and ensures unique IDs for each child record.
 *
 * @param responseBody - The API response body
 * @param childJob - The child job configuration
 * @param childRecord - The child record data
 * @param childIndex - The index of this child within siblings (optional)
 * @returns The extracted Priority ID or null if not found
 */
function extractChildPriorityId(
  responseBody: any,
  childJob: ChildJob,
  childRecord: any,
  childIndex?: number
): string | null {
  // Get the field name from the child job configuration
  const idFieldName = childJob.priority_id;

  // console.log(
  //   `Extracting ID for child: ${childRecord.RowId}, field: ${idFieldName}, index: ${childIndex}`
  // );
  // console.log(
  //   `Child job: ${childJob.JobTypeName}, screen: ${childJob.ScreenName}, HasSiblings: ${childJob.HasSiblings}`
  // );

  if (!idFieldName) {
    return null;
  }

  // Get the subform key based on screen name
  const subformKey = `${childJob.ScreenName}_SUBFORM`;
  // console.log(`Looking for subform key: ${subformKey}`);

  // Debug the response structure
  if (responseBody) {
    // console.log(`Response keys: ${Object.keys(responseBody).join(", ")}`);

    // Check if the subform exists
    if (responseBody[subformKey]) {
      const subform = responseBody[subformKey];

      if (Array.isArray(subform)) {
        // console.log(`Found array subform with ${subform.length} items`);

        // Debug first item structure if available
        if (
          subform.length > 0 &&
          childIndex !== undefined &&
          childIndex < subform.length
        ) {
          const item = subform[childIndex];
          // console.log(
          //   `Item at index ${childIndex} keys: ${Object.keys(item).join(", ")}`
          // );
          // console.log(`Item has idFieldName? ${!!item[idFieldName]}`);

          // Check for AU fields
          const auFields = Object.keys(item).filter((k) => k.includes("_AU"));
          if (auFields.length > 0) {
            //console.log(`Found AU fields: ${auFields.join(", ")}`);
            auFields.forEach((field) => {
              //console.log(`${field} value: ${item[field]}`);
            });
          }
        }
      } else if (typeof subform === "object") {
        // console.log(
        //   `Found object subform with keys: ${Object.keys(subform).join(", ")}`
        // );
        // console.log(`Subform has idFieldName? ${!!subform[idFieldName]}`);

        // Check for AU fields
        const auFields = Object.keys(subform).filter((k) => k.includes("_AU"));
        if (auFields.length > 0) {
          //console.log(`Found AU fields: ${auFields.join(", ")}`);
          auFields.forEach((field) => {
            // console.log(`${field} value: ${subform[field]}`);
          });
        }
      }
    } else {
      console.log(`Subform key ${subformKey} not found in response`);
      // Log the missing subform and full response body to a file
      logMissingSubformResponse(
        subformKey,
        responseBody,
        childJob,
        childRecord.RowId
      );
    }

    // Check if the ID field exists directly in the response
    // console.log(
    //   `Response has direct idFieldName? ${!!responseBody[idFieldName]}`
    // );

    // Check for AU fields in the response
    const auFields = Object.keys(responseBody).filter((k) => k.includes("_AU"));
    if (auFields.length > 0) {
      //console.log(`Found AU fields in response: ${auFields.join(", ")}`);
      auFields.forEach((field) => {
        // console.log(`${field} value: ${responseBody[field]}`);
      });
    }
  }

  // If the response has the subform
  if (responseBody && responseBody[subformKey]) {
    const subform = responseBody[subformKey];

    // For array of child records (HasSiblings=true)
    if (Array.isArray(subform)) {
      // If we have a specific index, use it to get the corresponding record
      if (
        childIndex !== undefined &&
        childIndex >= 0 &&
        childIndex < subform.length
      ) {
        const matchingRecord = subform[childIndex];

        // First try the configured priority_id field
        if (matchingRecord[idFieldName]) {
          return String(matchingRecord[idFieldName]);
        }

        // Then check for AU fields in this specific record
        for (const key of Object.keys(matchingRecord)) {
          if (key === idFieldName || key.includes("_AU")) {
            const value = matchingRecord[key];
            if (typeof value === "string" && value.includes("=")) {
              return value;
            }
          }
        }
      }
      // If no index is provided or it's invalid, try to match by properties
      else {
        // Try to find a matching record by comparing properties
        for (let i = 0; i < subform.length; i++) {
          const responseRecord = subform[i];
          let matchFound = false;

          // Look for key properties to match (excluding internal fields)
          for (const key of Object.keys(childRecord)) {
            if (
              !key.startsWith("__") &&
              key !== "RowId" &&
              childRecord[key] &&
              responseRecord[key] &&
              childRecord[key] === responseRecord[key]
            ) {
              matchFound = true;
              break;
            }
          }

          if (matchFound) {
            // Found a matching record - extract its ID
            if (responseRecord[idFieldName]) {
              return String(responseRecord[idFieldName]);
            }

            // Check for AU fields in this record
            for (const key of Object.keys(responseRecord)) {
              if (key === idFieldName || key.includes("_AU")) {
                const value = responseRecord[key];
                if (typeof value === "string" && value.includes("=")) {
                  return value;
                }
              }
            }
          }
        }

        // If we couldn't match by properties and we have the index within childRecords
        // Use the same index in the response (assuming ordering is preserved)
        if (
          childIndex !== undefined &&
          childIndex >= 0 &&
          childIndex < subform.length
        ) {
          const indexedRecord = subform[childIndex];

          if (indexedRecord[idFieldName]) {
            return String(indexedRecord[idFieldName]);
          }

          // Check for AU fields in this indexed record
          for (const key of Object.keys(indexedRecord)) {
            if (key === idFieldName || key.includes("_AU")) {
              const value = indexedRecord[key];
              if (typeof value === "string" && value.includes("=")) {
                return value;
              }
            }
          }
        }
      }
    }
    // For single child record (HasSiblings=false)
    else if (typeof subform === "object" && subform !== null) {
      if (subform[idFieldName]) {
        return String(subform[idFieldName]);
      }

      // Check for AU fields in the single subform
      for (const key of Object.keys(subform)) {
        if (key === idFieldName || key.includes("_AU")) {
          const value = subform[key];
          if (typeof value === "string" && value.includes("=")) {
            return value;
          }
        }
      }
    }
  }

  // Check for direct field access in the response body
  if (responseBody && responseBody[idFieldName]) {
    const idValue = responseBody[idFieldName];
    return idValue !== null && idValue !== undefined ? String(idValue) : null;
  }

  // Try special AU fields which might contain the ID
  for (const key of Object.keys(responseBody)) {
    if (key === idFieldName || key.includes("_AU")) {
      const value = responseBody[key];
      if (typeof value === "string" && value.includes("=")) {
        return value;
      }
    }
  }

  return null;
}
/**
 * Logs when a Priority ID field is missing from an API response.
 * Helps identify field mapping issues between the system and Priority.
 *
 * @param recordId - The record ID that was processed
 * @param tableName - The source table name
 * @param fieldName - The expected field name that was missing
 * @param jobId - The job identifier
 */
function logMissingPriorityField(
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
function logResponseError(
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
//-------------------------------------------------------------------------
/**
 * Adjusts the date to the local timezone by removing the timezone offset.
 * @param date - The date to adjust.
 * @returns The adjusted date in local timezone.
 */
const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

/**
 * Generates a clean error message by removing numbers and special characters,
 * while preserving Hebrew and English letters and spaces.
 */
const generateCleanError = (errorMessage: string | null): string | null => {
  if (!errorMessage) return null;
  return errorMessage
    .replace(/[0-9]/g, "")
    .replace(/[^\p{L}\s]/gu, "")
    .trim();
};

//-------------------------------------------------------------------------
/**
 * עיבוד תשובה מה-API עבור מבנה אב-ילדים
 * @param response - התשובה שהתקבלה מה-API
 * @param enrichedRecords - הרשומות שנשלחו מועשרות עם מידע נוסף
 * @param perfMonitor - מנטר ביצועים
 * @param parentTable - שם טבלת האב
 * @param batchId - מזהה המנה
 * @param jobType - סוג העבודה
 * @param jobId - מזהה העבודה
 * @param priorityIdField - שדה המזהה בפריוריטי
 * @param childTableNames - שמות טבלאות הילדים
 */
export async function processParentChildResponse(
  response: any,
  enrichedRecords: any[],
  perfMonitor: PerformanceMonitor,
  parentTable: string,
  batchId: string,
  jobType: string,
  jobId: string,
  priorityIdField?: string,
  childTableNames?: string[],
  childJobs?: ChildJob[],
  logErrors: boolean = false,
  updateBatchTable: boolean = false
): Promise<ProcessResponseResult> {
  try {
    // Start measuring DB update time
    const dbUpdateStart = performance.now();

    // Measure response performance
    measureResponsePerformance(response, perfMonitor);

    // IMPORTANT: Check if the response has a valid structure or contains errors
    const sentToPriority = !!(response && response.data);
    let apiErrorMessage = null;

    // Remove the console.warn for 400 errors - they're expected in many cases
    // Only log server errors (500+) which might indicate systemic issues
    if (response?.status >= 500) {
      apiErrorMessage =
        response?.data?.error?.message ||
        `API Error: Status ${response?.status}`;
      console.warn(
        `API returned error status ${response?.status}, but continuing with database updates`
      );
    }

    // Process API response - even if there are errors
    const {
      parentUpdateRows,
      childUpdateRows,
      errorRows,
      successCount,
      failureCount,
      lastProcessedIndex,
      sentToPriority: responseSuccess,
    } = processApiResponse(
      response,
      enrichedRecords,
      priorityIdField,
      childJobs
    );

    // Update performance metrics - THIS IS THE FIX
    perfMonitor.metrics.successCount = successCount;
    // Use the actual failure count instead of calculating it
    perfMonitor.metrics.failureCount = failureCount;
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // IMPORTANT: If API failed but we didn't capture failures in processing,
    // make sure we mark all records as failed
    if (apiErrorMessage && failureCount === 0) {
      // This is where we detect an API error but don't have specific failures
      // Add logging here:
      logResponseError(response, enrichedRecords[0], apiErrorMessage, jobId);

      // Force all parent records to be updated as failed
      parentUpdateRows.length = 0; // Clear any existing updates

      enrichedRecords.forEach((record) => {
        parentUpdateRows.push({
          RowId: record.RowId,
          BatchId: record.__batchId,
          JobName: record.__jobType,
          Status: "Failed",
          Error: apiErrorMessage,
          CleanError: generateCleanError(apiErrorMessage),
          JobId: record.__jobId,
          priority_id: null,
          is_new: 1,
          StatusCode: response?.status || 500,
        });

        // Add error record
        errorRows.push({
          JobName: record.__jobType,
          BatchId: record.__batchId,
          TableName: record.__tableName,
          RowId: record.RowId,
          Error: apiErrorMessage,
          JobId: record.__jobId,
          ErrorStatus: response?.status?.toString() || "400",
        });

        // Process child records if they exist
        if (childJobs && record.childRecords) {
          childJobs.forEach((job) => {
            const childTableName = job.DBTableName;
            const jobTypeName = job.JobTypeName;

            // Try to get child records with flexible lookup
            const childRecords = getChildRecords(
              record,
              jobTypeName,
              childTableName
            );

            if (
              childRecords &&
              Array.isArray(childRecords) &&
              childRecords.length > 0
            ) {
              childRecords.forEach((childRecord) => {
                childUpdateRows.push({
                  RowId: childRecord.RowId,
                  BatchId: record.__batchId,
                  JobName: record.__jobType,
                  Status: "Failed",
                  ErrorMessage: apiErrorMessage,
                  CleanError: generateCleanError(apiErrorMessage),
                  JobId: record.__jobId,
                  priority_id: null,
                  is_new: 1,
                  tableName: childTableName,
                  StatusCode: response?.status || 500,
                });
              });
            }
          });
        }
      });

      // Update success and failure counts - THIS IS ALSO A FIX
      perfMonitor.metrics.successCount = 0;
      perfMonitor.metrics.failureCount = enrichedRecords.length;
    }

    // Update performance metrics
    perfMonitor.metrics.successCount = successCount;
    perfMonitor.metrics.failureCount = enrichedRecords.length - successCount; // Ensure we count all failures
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // Database update tracking
    let totalDbUpdateTime = 0;
    const batchStatus = responseSuccess ? "Completed" : "Failed";
    let hadDeadlocks = false;

    // Always update parent records - even if we have errors
    if (parentUpdateRows.length > 0) {
      try {
        const result = await performBulkUpdateWithService(
          parentTable,
          parentUpdateRows,
          perfMonitor,
          undefined,
          3, // number of retries
          sentToPriority
        );

        totalDbUpdateTime += result.updateTime;
        hadDeadlocks = result.hadDeadlocks;

        if (hadDeadlocks && result.successful && sentToPriority) {
          // console.log(`Batch ${batchId} had deadlocks during parent DB update but completed successfully`);
        }
      } catch (dbError) {
        console.error("Error during parent database update:", dbError);
        // Continue with child updates despite error in parent updates
      }
    } else {
      console.warn(`No parent updates to process for batch ${batchId}`);
    }

    // Update child records - always attempt this even if parent updates failed
    if (childUpdateRows.length > 0) {
      try {
        // Group child updates by table name for efficiency
        const childUpdatesByTable: Record<string, any[]> = {};

        childUpdateRows.forEach((update) => {
          if (!update.tableName) {
            console.error(
              `❌ Child update missing tableName property:`,
              update
            );
            return;
          }
          const tableName = update.tableName;
          delete update.tableName; // Remove the table name before sending to DB

          if (!childUpdatesByTable[tableName]) {
            childUpdatesByTable[tableName] = [];
          }
          childUpdatesByTable[tableName].push(update);
        });

        // Process each child table
        for (const [tableName, updates] of Object.entries(
          childUpdatesByTable
        )) {
          try {
            // Force parameter types explicitly for each child table
            const updatesWithExplicitTypes = updates.map((update) => ({
              ...update,
              // Force each priority_id to be an explicit string or null
              priority_id:
                update.priority_id !== null && update.priority_id !== undefined
                  ? String(update.priority_id)
                  : null,
              // Make sure other fields match their expected types
              is_new: Number(update.is_new),
            }));

            // console.log(`Processing child table ${tableName} with ${updatesWithExplicitTypes.length} records`);
            // console.log(`First record sample: ${JSON.stringify(updatesWithExplicitTypes[0])}`);

            const childResult = await performBulkUpdateWithService(
              tableName,
              updatesWithExplicitTypes,
              perfMonitor,
              undefined,
              3,
              sentToPriority
            );

            // console.log(`✅ Updated ${updates.length} records in child table ${tableName}, success: ${childResult.successful}`);

            totalDbUpdateTime += childResult.updateTime;
            if (childResult.hadDeadlocks) hadDeadlocks = true;
          } catch (tableError) {
            console.error(
              `Error updating child table ${tableName}:`,
              tableError
            );
            // Continue with other tables despite error
          }
        }
      } catch (childDbError) {
        console.error("Error during child database update:", childDbError);
        // Continue with error logging despite errors in child updates
      }
    } else {
      // console.log(`No child updates to process for batch ${batchId}`);
    }

    // Insert error logs using the buffer instead of direct insertion
    if (errorRows.length > 0 && logErrors) {
      try {
        // Use error buffer service instead of immediate insert
        ErrorBufferService.getInstance().addErrors(errorRows);

        // Track DB update time (no direct insertion anymore)
        const estimatedUpdateTime = 0.1; // Just a small token value since we're not directly updating DB
        totalDbUpdateTime += estimatedUpdateTime;
      } catch (errorBufferError) {
        console.error("Failed to buffer error logs:", errorBufferError);
      }
    }

    // Ensure DB update time is recorded
    if (totalDbUpdateTime > 0 && !perfMonitor.metrics.dbUpdateTime) {
      perfMonitor.setDbUpdateTime(totalDbUpdateTime);
    }

    // Complete the operation and get metrics
    perfMonitor.endOperation();
    const formattedMetrics = perfMonitor.getFormattedMetrics();

    totalDbUpdateTime = performance.now() - dbUpdateStart;
    perfMonitor.setDbUpdateTime(totalDbUpdateTime);

    // Record batch processing results
    if (updateBatchTable) {
      await recordBatchProcessing(
        jobType,
        batchId,
        jobId,
        adjustTimeZone(new Date(perfMonitor.metrics.startTime)),
        adjustTimeZone(new Date(perfMonitor.metrics.endTime)),
        enrichedRecords.length,
        perfMonitor.metrics.successCount,
        perfMonitor.metrics.failureCount,
        perfMonitor.metrics.lastProcessedIndex,
        batchStatus,
        hadDeadlocks
          ? "DB update had deadlocks but completed successfully"
          : null,
        parentTable,
        updateBatchTable
      );
    }

    // Return success result
    return {
      success: true,
      message: "Batch processed successfully",
      successCount: perfMonitor.metrics.successCount,
      failureCount: perfMonitor.metrics.failureCount,
      responseCount: response?.data?.responses?.length || 0,
      averageTimePerRecord: formattedMetrics.averageTimePerRecord,
      performanceMetrics: {
        dbFetchTime: formattedMetrics.dbFetchTime,
        dbUpdateTime: formattedMetrics.dbUpdateTime,
        batchBuildTime: formattedMetrics.batchBuildTime,
        requestTime: formattedMetrics.requestTime,
        totalDuration: formattedMetrics.totalDuration,
      },
    };
  } catch (error) {
    console.error("Error processing parent-child response:", error);

    // IMPORTANT: Force database updates even when the processor itself fails
    try {
      await forceErrorDatabaseUpdates(
        enrichedRecords,
        error,
        parentTable,
        jobId,
        batchId,
        childJobs
      );
    } catch (forceUpdateError) {
      console.error("Failed to force error updates:", forceUpdateError);
    }

    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error in response processing",
      successCount: 0,
      failureCount: enrichedRecords.length,
      averageTimePerRecord: "N/A",
      performanceMetrics: {
        dbFetchTime: "N/A",
        dbUpdateTime: "N/A",
        batchBuildTime: "N/A",
        requestTime: "N/A",
        totalDuration: "N/A",
      },
    };
  }
}
//-------------------------------------------------------------------------
// Helper function to get child records with flexible lookup
function getChildRecords(
  record: any,
  jobTypeName: string,
  tableName?: string
): any[] | undefined {
  if (!record.childRecords) return undefined;

  // Try composite key first if table name is provided
  if (tableName) {
    const compositeKey = `${jobTypeName}_${tableName}`;
    if (record.childRecords[compositeKey]) {
      return record.childRecords[compositeKey];
    }
  }

  // Try exact match with job type name
  if (record.childRecords[jobTypeName]) {
    return record.childRecords[jobTypeName];
  }

  // Try case-insensitive match
  const lcKey = jobTypeName.toLowerCase();
  const ucKey = jobTypeName.toUpperCase();

  if (record.childRecords[lcKey]) {
    return record.childRecords[lcKey];
  }

  if (record.childRecords[ucKey]) {
    return record.childRecords[ucKey];
  }

  // Try partial matches
  for (const key of Object.keys(record.childRecords)) {
    if (key.includes(jobTypeName) || jobTypeName.includes(key)) {
      return record.childRecords[key];
    }
  }

  return undefined;
}
//-------------------------------------------------------------------------
// Helper function to force database updates when processor fails
async function forceErrorDatabaseUpdates(
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
      await performBulkUpdateWithService(parentTable, parentUpdates);
      // console.log(`Updated ${parentUpdates.length} parent records with error status`);
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
        await performBulkUpdateWithService(tableName, updates);
        // console.log(`Updated ${updates.length} records in child table ${tableName}`);
      }
    }
  } catch (dbError) {
    console.error("Failed to update database with error information:", dbError);
  }
}
//-------------------------------------------------------------------------
/**
 * עיבוד התגובה מה-API והכנת השורות לעדכון
 * @param response - התגובה מה-API
 * @param enrichedRecords - הרשומות ששלחנו
 * @param priorityIdField - שדה המזהה בפריוריטי
 * @returns מידע מעובד על הצלחות, כישלונות ושורות לעדכון
 */
function processApiResponse(
  response: any,
  enrichedRecords: any[],
  priorityIdField?: string,
  childJobs?: ChildJob[]
) {
  // Default error result as before
  const defaultErrorResult = {
    parentUpdateRows: [],
    childUpdateRows: [],
    errorRows: [],
    successCount: 0,
    failureCount: enrichedRecords.length,
    lastProcessedIndex: -1,
    sentToPriority: false,
  };

  if (!response || !response.data) {
    console.error("Invalid API response: response or response.data is missing");
    return defaultErrorResult;
  }

  if (!response.data.responses) {
    console.error(
      "Response missing 'responses' array - creating error records for all items"
    );

    // Create error updates for all records instead of returning empty arrays
    const parentUpdateRows = enrichedRecords.map((record) => ({
      RowId: record.RowId,
      BatchId: record.__batchId,
      JobName: record.__jobType,
      Status: "Failed",
      Error: response.data.error?.message || "Missing response structure",
      CleanError: generateCleanError(
        response.data.error?.message || "Missing response structure"
      ),
      JobId: record.__jobId,
      priority_id: null,
      is_new: 1,
      StatusCode: response.status || 500,
    }));

    const errorRows = enrichedRecords.map((record) => ({
      JobName: record.__jobType,
      BatchId: record.__batchId,
      TableName: record.__tableName,
      RowId: record.RowId,
      Error: response.data.error?.message || "Missing response structure",
      JobId: record.__jobId,
      ErrorStatus: response.status?.toString() || "500",
    }));

    return {
      parentUpdateRows,
      childUpdateRows: [], // We'll handle child records elsewhere
      errorRows,
      successCount: 0,
      failureCount: enrichedRecords.length,
      lastProcessedIndex: -1,
      sentToPriority: true, // Indicate we tried sending to Priority
    };
  }

  const apiResponses = response.data.responses;
  const parentUpdateRows: any[] = [];
  const childUpdateRows: any[] = [];
  const errorRows: any[] = [];
  let successCount = 0;
  let failureCount = 0;
  let lastProcessedIndex = -1;

  // Process each response
  apiResponses.forEach((apiResponse: any, index: number) => {
    lastProcessedIndex = index;
    const record = enrichedRecords[index];
    const isSuccess = apiResponse.status >= 200 && apiResponse.status < 300;
    const statusCode = apiResponse.status; // Extract HTTP status code

    if (isSuccess) {
      successCount++;

      // Process parent record
      const parentUpdate = {
        RowId: record.RowId,
        BatchId: record.__batchId,
        JobName: record.__jobType,
        Status: "Completed",
        Error: null,
        CleanError: null,
        JobId: record.__jobId,
        priority_id: null as string | null, // Explicitly type as string|null for SQL compatibility
        is_new: 0,
        StatusCode: statusCode,
      };

      // Extract Priority ID for parent record
      if (apiResponse.body && priorityIdField) {
        try {
          const responseBody =
            typeof apiResponse.body === "string"
              ? JSON.parse(apiResponse.body)
              : apiResponse.body;

          // Extract parent ID using generic field access
          parentUpdate.priority_id = extractPriorityId(
            responseBody,
            priorityIdField
          );

          if (parentUpdate.priority_id !== null) {
            // console.log(
            //   `✅ Found parent priority_id '${priorityIdField}' with value: ${parentUpdate.priority_id}`
            // );
          } else {
            // Log missing parent field
            logMissingPriorityField(
              record.RowId,
              record.__tableName || "unknown",
              priorityIdField,
              record.__jobId
            );
          }
        } catch (e) {
          console.warn(`Failed to parse response body for record ${index}`, e);
        }
      }
      parentUpdateRows.push(parentUpdate);

      // Process child records with success status
      if (childJobs && record.childRecords) {
        childJobs.forEach((job) => {
          const childTableName = job.DBTableName;
          const jobTypeName = job.JobTypeName;

          // Find child records with enhanced lookup
          const childRecords = getChildRecords(
            record,
            jobTypeName,
            childTableName
          );

          if (
            childRecords &&
            Array.isArray(childRecords) &&
            childRecords.length > 0
          ) {
            // console.log(
            //   `Found ${childRecords.length} child records for job ${jobTypeName}, parent ${record.RowId}`
            // );

            childRecords.forEach((childRecord, childIndex) => {
              if (!childRecord.RowId) {
                // console.error(
                //   `Child record missing RowId for job ${jobTypeName}`
                // );
                return;
              }

              // Prepare child update with defaults
              const childUpdate = {
                RowId: childRecord.RowId,
                BatchId: record.__batchId,
                JobName: record.__jobType,
                Status: "Completed",
                Error: null,
                CleanError: null,
                JobId: record.__jobId,
                priority_id: null as string | null,
                is_new: 0,
                tableName: childTableName,
                StatusCode: statusCode,
              };

              // Extract child ID using our enhanced function
              if (apiResponse.body && job.priority_id) {
                try {
                  const responseBody =
                    typeof apiResponse.body === "string"
                      ? JSON.parse(apiResponse.body)
                      : apiResponse.body;

                  // Use the enhanced extraction function that handles various formats
                  const priorityId = extractChildPriorityId(
                    responseBody,
                    job,
                    childRecord,
                    childIndex
                  );

                  if (priorityId !== null) {
                    childUpdate.priority_id = priorityId;
                    // console.log(
                    //   `✅ Successfully extracted priority_id '${job.priority_id}' with value: ${priorityId} for child ${childRecord.RowId}`
                    // );
                  } else {
                    // Log missing field
                    logMissingPriorityField(
                      childRecord.RowId,
                      childTableName,
                      job.priority_id,
                      record.__jobId
                    );
                  }
                } catch (e) {
                  console.error(
                    `Error extracting child ID for ${jobTypeName}:`,
                    e
                  );
                }
              }

              // Add to the childUpdateRows array
              childUpdateRows.push(childUpdate);
            });
          } else {
            console.log(
              `No valid child records found for job ${jobTypeName} - parent record RowId: ${record.RowId}`
            );
          }
        });
      }
      //-------------------------------------------------
    } else {
      // Handle error case
      failureCount++;

      // Extract error message
      let errorMessage = "Unknown error";
      try {
        if (apiResponse.body) {
          const errorBody =
            typeof apiResponse.body === "string"
              ? JSON.parse(apiResponse.body)
              : apiResponse.body;

          if (errorBody?.FORM?.InterfaceErrors?.text) {
            // Priority-specific error format
            errorMessage = errorBody.FORM.InterfaceErrors.text;
          } else {
            errorMessage =
              errorBody.error || errorBody.message || JSON.stringify(errorBody);
          }
        }
      } catch (e) {
        errorMessage = apiResponse.body || "Failed to parse error response";
      }

      const statusCode =
        apiResponse.status ||
        (typeof apiResponse.body === "string" &&
        apiResponse.body.includes('"code"')
          ? JSON.parse(apiResponse.body).code
          : "Unknown");

      // Ensure errorMessage is always a string for parent record
      const safeParentErrorMessage =
        typeof errorMessage === "string"
          ? errorMessage
          : errorMessage
            ? JSON.stringify(errorMessage)
            : "Unknown error";

      // Update parent record with error - with all required columns
      parentUpdateRows.push({
        RowId: record.RowId,
        BatchId: record.__batchId,
        JobName: record.__jobType,
        Status: "Failed",
        Error: safeParentErrorMessage,
        CleanError: generateCleanError(safeParentErrorMessage),
        JobId: record.__jobId,
        priority_id: null, // Explicitly set to null for SQL compatibility
        is_new: 1,
        StatusCode: statusCode,
      });

      // Update child records with the same error
      if (childJobs && record.childRecords) {
        childJobs.forEach((job) => {
          const childTableName = job.DBTableName;
          const jobTypeName = job.JobTypeName;

          // Use our enhanced lookup function
          const childRecords = getChildRecords(
            record,
            jobTypeName,
            childTableName
          );

          if (childRecords && Array.isArray(childRecords)) {
            childRecords.forEach((childRecord) => {
              // Ensure errorMessage is always a string
              const safeErrorMessage =
                typeof errorMessage === "string"
                  ? errorMessage
                  : errorMessage
                    ? JSON.stringify(errorMessage)
                    : "Unknown error";

              // Create the childUpdate object with proper SQL-compatible values
              const childUpdate = {
                RowId: childRecord.RowId,
                BatchId: record.__batchId,
                JobName: record.__jobType,
                Status: "Failed",
                Error: safeErrorMessage,
                CleanError: generateCleanError(safeErrorMessage),
                JobId: record.__jobId,
                priority_id: null, // Explicitly set to null for SQL compatibility
                is_new: 1,
                tableName: childTableName,
                StatusCode: statusCode,
              };

              childUpdateRows.push(childUpdate);
            });
          }
        });
      }

      // Add error log entry
      errorRows.push({
        JobName: record.__jobType,
        BatchId: record.__batchId,
        TableName: record.__tableName,
        RowId: record.RowId,
        Error: safeParentErrorMessage,
        JobId: record.__jobId,
        ErrorStatus: statusCode.toString(),
      });
    }
  });

  return {
    parentUpdateRows,
    childUpdateRows,
    errorRows,
    successCount,
    failureCount,
    lastProcessedIndex,
    sentToPriority: true,
  };
}
