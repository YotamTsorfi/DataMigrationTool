import PerformanceMonitor from "../utils/performanceMonitor";
import { measureResponsePerformance } from "../services/requestSender";
import {
  performBulkUpdateWithService,
  performBulkErrorInsertWithService,
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
  childJobs?: ChildJob[]
): Promise<ProcessResponseResult> {
  // Add diagnostic logging for troubleshooting
  // console.log(`Processing response for ${enrichedRecords.length} records from ${parentTable}`);
  // console.log(`Response status: ${response?.status || 'unknown'}, has data: ${!!response?.data}`);

  try {
    // Start measuring DB update time
    const dbUpdateStart = Date.now();

    // Measure response performance
    measureResponsePerformance(response, perfMonitor);

    // IMPORTANT: Check if the response has a valid structure or contains errors
    const sentToPriority = !!(response && response.data);
    let apiErrorMessage = null;

    if (response?.status >= 400 || (response?.data?.error)) {
      apiErrorMessage = response?.data?.error?.message || `API Error: Status ${response?.status}`;
      console.warn(`API returned error status ${response?.status}, but continuing with database updates`);
    }

    // Process API response - even if there are errors
    const {
      parentUpdateRows,
      childUpdateRows,
      errorRows,
      successCount,
      failureCount,
      lastProcessedIndex,
      sentToPriority: responseSuccess
    } = processApiResponse(response, enrichedRecords, priorityIdField, childJobs);

    // Update performance metrics - THIS IS THE FIX
    perfMonitor.metrics.successCount = successCount;
    // Use the actual failure count instead of calculating it
    perfMonitor.metrics.failureCount = failureCount;
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // IMPORTANT: If API failed but we didn't capture failures in processing,
    // make sure we mark all records as failed
    if (apiErrorMessage && failureCount === 0) {
      // console.log(`API returned error but no failures detected. Marking all ${enrichedRecords.length} records as failed`);

      // Force all parent records to be updated as failed
      parentUpdateRows.length = 0; // Clear any existing updates

      enrichedRecords.forEach(record => {
        parentUpdateRows.push({
          RowId: record.RowId,
          BatchId: record.__batchId,
          JobName: record.__jobType,
          Status: "Failed",
          ErrorMessage: apiErrorMessage,
          JobId: record.__jobId,
          priority_id: null,
          is_new: 1
        });

        // Add error record
        errorRows.push({
          JobName: record.__jobType,
          BatchId: record.__batchId,
          TableName: record.__tableName,
          RowId: record.RowId,
          Error: apiErrorMessage,
          JobId: record.__jobId,
          ErrorStatus: response?.status?.toString() || "400"
        });

        // Process child records if they exist
        if (childJobs && record.childRecords) {
          childJobs.forEach(job => {
            const childTableName = job.DBTableName;
            const jobTypeName = job.JobTypeName;

            // Try to get child records with flexible lookup
            const childRecords = getChildRecords(record, jobTypeName);

            if (childRecords && Array.isArray(childRecords) && childRecords.length > 0) {
              childRecords.forEach(childRecord => {
                childUpdateRows.push({
                  RowId: childRecord.RowId,
                  BatchId: record.__batchId,
                  JobName: record.__jobType,
                  Status: "Failed",
                  ErrorMessage: apiErrorMessage,
                  JobId: record.__jobId,
                  priority_id: null,
                  is_new: 1,
                  tableName: childTableName
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
    let batchStatus = responseSuccess ? "Completed" : "Failed";
    let hadDeadlocks = false;

    // Always update parent records - even if we have errors
    if (parentUpdateRows.length > 0) {
      try {
        // console.log(`Updating ${parentUpdateRows.length} parent records in table ${parentTable}`);
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

        childUpdateRows.forEach(update => {
          if (!update.tableName) {
            console.error(`❌ Child update missing tableName property:`, update);
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
        // console.log(`Updating child records in ${Object.keys(childUpdatesByTable).length} tables`);
        for (const [tableName, updates] of Object.entries(childUpdatesByTable)) {
          // console.log(`Updating ${updates.length} records in child table ${tableName}`);

          try {
            const childResult = await performBulkUpdateWithService(
              tableName,
              updates,
              perfMonitor,
              undefined,
              3,
              sentToPriority
            );

            totalDbUpdateTime += childResult.updateTime;
            if (childResult.hadDeadlocks) hadDeadlocks = true;
          } catch (tableError) {
            console.error(`Error updating child table ${tableName}:`, tableError);
            // Continue with other tables despite error
          }
        }
      } catch (childDbError) {
        console.error("Error during child database update:", childDbError);
        // Continue with error logging despite errors in child updates
      }
    } else {
      console.log(`No child updates to process for batch ${batchId}`);
    }

    // Insert error logs using the buffer instead of direct insertion
    if (errorRows.length > 0) {
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

    // Record batch processing results
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
      hadDeadlocks ? "DB update had deadlocks but completed successfully" : null,
      parentTable
    );

    // console.log(`Batch ${batchId} processing completed: ${successCount} successful, ${perfMonitor.metrics.failureCount} failed`);

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
      message: error instanceof Error ? error.message : "Unknown error in response processing",
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

// Helper function to get child records with flexible lookup
function getChildRecords(record: any, jobTypeName: string): any[] | undefined {
  if (!record.childRecords) return undefined;

  // Try exact match
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

// Helper function to force database updates when processor fails
async function forceErrorDatabaseUpdates(
  records: any[],
  error: any,
  parentTable: string,
  jobId: string,
  batchId: string,
  childJobs?: ChildJob[]
): Promise<void> {
  console.log(`Forcing database updates for ${records.length} records due to processor error`);

  const errorMessage = error instanceof Error ? error.message : String(error);

  // Create parent updates
  const parentUpdates = records.map(record => ({
    RowId: record.RowId,
    BatchId: record.__batchId || batchId,
    JobName: record.__jobType,
    Status: "Failed",
    ErrorMessage: errorMessage,
    JobId: jobId,
    priority_id: null,
    is_new: 1
  }));

  // Create error logs
  const errorLogs = records.map(record => ({
    JobName: record.__jobType,
    BatchId: record.__batchId || batchId,
    TableName: record.__tableName || parentTable,
    RowId: record.RowId,
    Error: errorMessage,
    JobId: jobId,
    ErrorStatus: "PROCESSOR_ERROR"
  }));

  // Create child updates if applicable
  const childUpdates: any[] = [];

  if (childJobs && childJobs.length > 0) {
    records.forEach(record => {
      if (record.childRecords) {
        childJobs.forEach(job => {
          const childRecords = getChildRecords(record, job.JobTypeName);

          if (childRecords && Array.isArray(childRecords)) {
            childRecords.forEach(childRecord => {
              childUpdates.push({
                RowId: childRecord.RowId,
                BatchId: record.__batchId || batchId,
                JobName: record.__jobType,
                Status: "Failed",
                ErrorMessage: errorMessage,
                JobId: jobId,
                priority_id: null,
                is_new: 1,
                tableName: job.DBTableName
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
    if (errorLogs.length > 0) {
      ErrorBufferService.getInstance().addErrors(errorLogs);
    }

    if (childUpdates.length > 0) {
      // Group by table name
      const childUpdatesByTable: Record<string, any[]> = {};

      childUpdates.forEach(update => {
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

  if (!response || !response.data || !response.data.responses) {
    console.error("Invalid API response structure");
    return defaultErrorResult;
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

    if (isSuccess) {
      successCount++;

      // Process parent record
      const parentUpdate = {
        RowId: record.RowId,
        BatchId: record.__batchId,
        JobName: record.__jobType,
        Status: "Completed",
        ErrorMessage: null,
        JobId: record.__jobId,
        priority_id: null as string | null, // Explicitly type as string|null for SQL compatibility
        is_new: 0
      };

      // Extract Priority ID if available
      if (apiResponse.body && priorityIdField) {
        try {
          const responseBody = typeof apiResponse.body === "string"
            ? JSON.parse(apiResponse.body)
            : apiResponse.body;

          if (responseBody && responseBody[priorityIdField] !== undefined) {
            // Ensure priority_id is stored as a string or null
            const idValue = responseBody[priorityIdField];
            parentUpdate.priority_id = idValue !== null && idValue !== undefined
              ? String(idValue) // Convert to string
              : null;
            // console.log(`Found parent priority_id: ${parentUpdate.priority_id} from field: ${priorityIdField}`);
          }
        } catch (e) {
          console.warn(`Failed to parse response body for record ${index}`, e);
        }
      }

      parentUpdateRows.push(parentUpdate);

      // Update child records with success status
      if (childJobs && record.childRecords) {
        // console.log(`Processing ${childJobs.length} child job types for successful parent RowId: ${record.RowId}`);

        // DEBUG: Log child record structure to help diagnose issues
        const childRecordKeys = Object.keys(record.childRecords || {});
        if (childRecordKeys.length === 0) {
          // console.log(`DEBUG: No child record keys found for parent ${record.RowId}`);
        } else {
          // console.log(`DEBUG: Found child record keys: ${childRecordKeys.join(', ')} for parent ${record.RowId}`);
        }

        childJobs.forEach(job => {
          const childTableName = job.DBTableName;
          const jobTypeName = job.JobTypeName;

          // Find child records with enhanced lookup
          const childRecords = getChildRecords(record, jobTypeName);

          // Only process child records if we found any
          if (childRecords && Array.isArray(childRecords) && childRecords.length > 0) {
            // console.log(`Found ${childRecords.length} child records for job ${jobTypeName}, parent ${record.RowId}`);

            childRecords.forEach(childRecord => {
              // Ensure childRecord has a RowId
              if (!childRecord.RowId) {
                // console.error(`Child record missing RowId for job ${jobTypeName}`);
                return;
              }

              // For successful records, prepare child update data
              const childUpdate = {
                RowId: childRecord.RowId,
                BatchId: record.__batchId,
                JobName: record.__jobType,
                Status: "Completed",
                ErrorMessage: null,
                JobId: record.__jobId,
                priority_id: null as string | null, // Explicitly type as string|null for SQL compatibility
                is_new: 0,
                tableName: childTableName
              };

              // Extract Priority ID for child record if available
              if (apiResponse.body && job.priority_id) {
                try {
                  const responseBody = typeof apiResponse.body === "string"
                    ? JSON.parse(apiResponse.body)
                    : apiResponse.body;

                  // console.log(`Looking for child priority_id in field: ${job.priority_id}`);

                  // Extract subform key based on job's screen name
                  const subformKey = `${job.ScreenName}_SUBFORM`;
                  // console.log(`Looking for subform key: ${subformKey}`);

                  // Check if response has the subform key
                  if (responseBody && responseBody[subformKey] !== undefined) {
                    // Log what we found for debugging
                    // console.log(`Found subform in response: ${typeof responseBody[subformKey]} with value:`,
                    //   JSON.stringify(responseBody[subformKey]).substring(0, 200) + '...');

                    // Case 1: HasSiblings=true - expect an array of child records
                    if (job.HasSiblings && Array.isArray(responseBody[subformKey])) {
                      //console.log(`Processing subform as array with ${responseBody[subformKey].length} items`);

                      // Try to find matching child record in the array
                      for (let i = 0; i < responseBody[subformKey].length; i++) {
                        const item = responseBody[subformKey][i];
                        if (item && item[job.priority_id] !== undefined) {
                          const idValue = item[job.priority_id];
                          childUpdate.priority_id = idValue !== null && idValue !== undefined
                            ? String(idValue)
                            : null;
                          // console.log(`Found child priority_id: ${childUpdate.priority_id} from subform array item ${i} field: ${job.priority_id}`);
                          break; // Found a match, no need to continue
                        }
                      }

                      // If no match was found in the array
                      if (childUpdate.priority_id === null) {
                        // console.log(`No matching child record found with field ${job.priority_id} in subform array`);
                        // Try to use the first item's ID if available as fallback
                        if (responseBody[subformKey].length > 0 && responseBody[subformKey][0][job.priority_id] !== undefined) {
                          const idValue = responseBody[subformKey][0][job.priority_id];
                          childUpdate.priority_id = idValue !== null ? String(idValue) : null;
                          // console.log(`Using first item's ${job.priority_id} as fallback: ${childUpdate.priority_id}`);
                        }
                      }
                    }
                    // Case 2: HasSiblings=false - expect a single object
                    else if (!job.HasSiblings) {
                      // Handle single object case
                      const subformData = responseBody[subformKey];

                      // If it's an array with one item, use that item
                      if (Array.isArray(subformData) && subformData.length > 0) {
                        // console.log(`Subform is an array with ${subformData.length} items but HasSiblings=false, using first item`);
                        if (subformData[0][job.priority_id] !== undefined) {
                          const idValue = subformData[0][job.priority_id];
                          childUpdate.priority_id = idValue !== null ? String(idValue) : null;
                          // console.log(`Found child priority_id: ${childUpdate.priority_id} from first array item field: ${job.priority_id}`);
                        }
                      }
                      // If it's a direct object, use it
                      else if (typeof subformData === 'object' && subformData !== null) {
                        // console.log(`Subform is a direct object`);
                        if (subformData[job.priority_id] !== undefined) {
                          const idValue = subformData[job.priority_id];
                          childUpdate.priority_id = idValue !== null ? String(idValue) : null;
                          // console.log(`Found child priority_id: ${childUpdate.priority_id} from subform object field: ${job.priority_id}`);
                        }
                      }
                    }
                    // Additional case: If HasSiblings is true but the response is an object (not an array)
                    else if (job.HasSiblings && !Array.isArray(responseBody[subformKey]) && typeof responseBody[subformKey] === 'object') {
                      // console.log(`Expected array for ${subformKey} but got object - trying to adapt`);

                      // Try to extract ID from the object directly
                      if (responseBody[subformKey][job.priority_id] !== undefined) {
                        const idValue = responseBody[subformKey][job.priority_id];
                        childUpdate.priority_id = idValue !== null ? String(idValue) : null;
                        // console.log(`Found child priority_id: ${childUpdate.priority_id} from direct object access with field: ${job.priority_id}`);
                      }
                    }
                  }
                  // Fallback: Try to find priority_id directly in the response body
                  else if (responseBody && responseBody[job.priority_id] !== undefined) {
                    const idValue = responseBody[job.priority_id];
                    childUpdate.priority_id = idValue !== null ? String(idValue) : null;
                    // console.log(`Fallback: Found child priority_id at root level: ${childUpdate.priority_id} from field: ${job.priority_id}`);
                  }
                  else {
                    // console.log(`Subform key ${subformKey} not found in response. Available keys:`, Object.keys(responseBody));
                  }
                } catch (e) {
                  console.warn(`Failed to parse response body for child record`, e);
                }
              } else {
                console.log(`No job.priority_id defined for child job ${jobTypeName} or no response body`);
              }

              childUpdateRows.push(childUpdate);
            });
          } else {
            console.log(`No valid child records found for job ${jobTypeName} - parent record RowId: ${record.RowId}`);
          }
        });
      }

    } else {
      // Handle error case
      failureCount++;

      // Extract error message
      let errorMessage = "Unknown error";
      try {
        if (apiResponse.body) {
          const errorBody = typeof apiResponse.body === "string"
            ? JSON.parse(apiResponse.body)
            : apiResponse.body;

          if (errorBody?.FORM?.InterfaceErrors?.text) {
            // Priority-specific error format
            errorMessage = errorBody.FORM.InterfaceErrors.text;
          } else {
            errorMessage = errorBody.error || errorBody.message || JSON.stringify(errorBody);
          }
        }
      } catch (e) {
        errorMessage = apiResponse.body || "Failed to parse error response";
      }

      // Ensure errorMessage is always a string for parent record
      const safeParentErrorMessage = typeof errorMessage === 'string'
        ? errorMessage
        : errorMessage ? JSON.stringify(errorMessage) : "Unknown error";

      // Update parent record with error - with all required columns
      parentUpdateRows.push({
        RowId: record.RowId,
        BatchId: record.__batchId,
        JobName: record.__jobType,
        Status: "Failed",
        ErrorMessage: safeParentErrorMessage,
        JobId: record.__jobId,
        priority_id: null, // Explicitly set to null for SQL compatibility
        is_new: 1
      });

      // Update child records with the same error
      if (childJobs && record.childRecords) {
        childJobs.forEach(job => {
          const childTableName = job.DBTableName;
          const jobTypeName = job.JobTypeName;

          // Use our enhanced lookup function
          const childRecords = getChildRecords(record, jobTypeName);

          if (childRecords && Array.isArray(childRecords)) {
            childRecords.forEach(childRecord => {
              // Ensure errorMessage is always a string
              const safeErrorMessage = typeof errorMessage === 'string'
                ? errorMessage
                : errorMessage ? JSON.stringify(errorMessage) : "Unknown error";

              // Create the childUpdate object with proper SQL-compatible values
              const childUpdate = {
                RowId: childRecord.RowId,
                BatchId: record.__batchId,
                JobName: record.__jobType,
                Status: "Failed",
                ErrorMessage: safeErrorMessage,
                JobId: record.__jobId,
                priority_id: null, // Explicitly set to null for SQL compatibility
                is_new: 1,
                tableName: childTableName
              };

              childUpdateRows.push(childUpdate);
            });
          }
        });
      }

      const statusCode = apiResponse.status ||
        (typeof apiResponse.body === 'string' && apiResponse.body.includes('"code"')
          ? JSON.parse(apiResponse.body).code
          : "Unknown");

      // Add error log entry
      errorRows.push({
        JobName: record.__jobType,
        BatchId: record.__batchId,
        TableName: record.__tableName,
        RowId: record.RowId,
        Error: safeParentErrorMessage,
        JobId: record.__jobId,
        ErrorStatus: statusCode.toString()
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