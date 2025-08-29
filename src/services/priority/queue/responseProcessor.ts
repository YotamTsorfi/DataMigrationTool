/**
 * This file contains the main response processing logic for Priority API responses.
 * It handles parent-child relationships and updates database records with response data.
 * The file delegates specialized functionality to helper modules to maintain clarity.
 */

import { adjustTimeZone } from "../../../utils/dateUtils";
import { ErrorBufferService } from "../../../utils/errorBufferService";
import { generateCleanError } from "../../../utils/errorUtils";
import {
  PerformanceMonitor,
  measureResponsePerformance,
} from "../../../utils/performanceMonitor";
import { ChildJob, ProcessResponseResult } from "../../../types/jobTypes";
import { DatabaseService } from "../../database/databaseService";
import { extractPriorityId, extractChildPriorityId } from "./idExtractor";
import {
  logMissingPriorityField,
  logResponseError,
  forceErrorDatabaseUpdates,
} from "./errorHandler";
import { getChildRecords } from "./childRecordHelper";

//-------------------------------------------------------------------------
/**
 * Processes the API response for parent-child relationships.
 * @param response - The API response object
 * @param enrichedRecords - The enriched records to update
 * @param perfMonitor - The performance monitor instance
 * @param parentTable - The parent table name
 * @param batchId - The batch ID for the operation
 * @param jobType - The type of job being processed
 * @param jobId - The unique job identifier
 * @param priorityIdField - The field name for the Priority ID
 * @param childJobs - The child job definitions
 * @param logErrors - Whether to log detailed errors
 * @param updateBatchTable - Whether to update the batch tracking table
 * @param originalRequestPayload - The original request payload
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
  childJobs?: ChildJob[],
  logErrors: boolean = false,
  updateBatchTable: boolean = false,
  originalRequestPayload?: any
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
      childJobs,
      originalRequestPayload
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
        const result = await DatabaseService.performBulkUpdateWithService(
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

            const childResult =
              await DatabaseService.performBulkUpdateWithService(
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
      await DatabaseService.recordBatchProcessing(
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
  childJobs?: ChildJob[],
  originalRequestPayload?: any
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
                    childIndex,
                    originalRequestPayload
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
