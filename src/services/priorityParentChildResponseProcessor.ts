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

    if (response?.status >= 400 || response?.data?.error) {
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

            // ====== התיקון המוצע מסתיים כאן ======

            const childResult = await performBulkUpdateWithService(
              tableName,
              updatesWithExplicitTypes,
              perfMonitor,
              undefined,
              3,
              sentToPriority
            );

            // לוג הצלחה לאחר העדכון
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

      // Extract Priority ID if available
      if (apiResponse.body && priorityIdField) {
        try {
          const responseBody =
            typeof apiResponse.body === "string"
              ? JSON.parse(apiResponse.body)
              : apiResponse.body;

          if (responseBody && responseBody[priorityIdField] !== undefined) {
            // Ensure priority_id is stored as a string or null
            const idValue = responseBody[priorityIdField];
            parentUpdate.priority_id =
              idValue !== null && idValue !== undefined
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
        // DEBUG: Log child record structure to help diagnose issues
        const childRecordKeys = Object.keys(record.childRecords || {});
        if (childRecordKeys.length === 0) {
          // console.log(`DEBUG: No child record keys found for parent ${record.RowId}`);
        } else {
          // console.log(`DEBUG: Found child record keys: ${childRecordKeys.join(', ')} for parent ${record.RowId}`);
        }

        childJobs.forEach((job) => {
          const childTableName = job.DBTableName;
          const jobTypeName = job.JobTypeName;

          // Find child records with enhanced lookup
          //OLD
          //const childRecords = getChildRecords(record, jobTypeName);
          const childRecords = getChildRecords(
            record,
            jobTypeName,
            childTableName
          );

          // Only process child records if we found any
          if (
            childRecords &&
            Array.isArray(childRecords) &&
            childRecords.length > 0
          ) {
            // console.log(`Found ${childRecords.length} child records for job ${jobTypeName}, parent ${record.RowId}`);

            childRecords.forEach((childRecord) => {
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
                Error: null,
                CleanError: null,
                JobId: record.__jobId,
                priority_id: null as string | null, // Explicitly type as string|null for SQL compatibility
                is_new: 0,
                tableName: childTableName,
                StatusCode: statusCode,
              };

              // Extract Priority ID for child record if available
              if (apiResponse.body && job.priority_id) {
                try {
                  const responseBody =
                    typeof apiResponse.body === "string"
                      ? JSON.parse(apiResponse.body)
                      : apiResponse.body;

                  // console.log(`Processing child record extraction for job: ${jobTypeName}, Screen: ${job.ScreenName}, priority_id: ${job.priority_id}`);

                  // Extract subform key based on job's screen name
                  const subformKey = `${job.ScreenName}_SUBFORM`;

                  // Check if subform exists in response
                  if (responseBody && responseBody[subformKey] !== undefined) {
                    const matchingItem = responseBody[subformKey].find(
                      (item: any) =>
                        item[job.priority_id] === childRecord[job.priority_id]
                    );
                    if (matchingItem) {
                      const idValue = matchingItem[job.priority_id];
                      childUpdate.priority_id =
                        idValue !== null ? String(idValue) : null;
                      childUpdate.RowId = childRecord.RowId; // עדכון ה-RowId המתאים
                    }

                    // Case 1: HasSiblings=true - רשומות במערך (לדוגמה NATF_ACCPERSONNEL_SUBFORM)
                    if (
                      job.HasSiblings &&
                      Array.isArray(responseBody[subformKey])
                    ) {
                      // console.log(`Found array subform ${subformKey} with ${responseBody[subformKey].length} items`);

                      // לולאה על כל הרשומות במערך בחיפוש אחר התאמה
                      let foundMatch = false;

                      for (
                        let i = 0;
                        i < responseBody[subformKey].length;
                        i++
                      ) {
                        const item = responseBody[subformKey][i];

                        // בדוק אם השדה המבוקש קיים ברשומה הנוכחית
                        if (item && item[job.priority_id] !== undefined) {
                          const idValue = item[job.priority_id];
                          childUpdate.priority_id =
                            idValue !== null && idValue !== undefined
                              ? String(idValue)
                              : null;

                          // console.log(`✓ Found child ID in array item ${i}: ${childUpdate.priority_id}`);
                          foundMatch = true;
                          break;
                        }
                      }

                      // אם לא נמצאה התאמה, ננסה לקחת מהרשומה הראשונה
                      if (!foundMatch && responseBody[subformKey].length > 0) {
                        const firstItem = responseBody[subformKey][0];
                        if (firstItem[job.priority_id] !== undefined) {
                          const idValue = firstItem[job.priority_id];
                          childUpdate.priority_id =
                            idValue !== null ? String(idValue) : null;
                          console.log(
                            `Using first item's ${job.priority_id} as fallback: ${childUpdate.priority_id}`
                          );
                        } else {
                          console.log(
                            `No ${job.priority_id} field found in first array item`
                          );
                        }
                      }
                    }
                    // Case 2: HasSiblings=false - אובייקט בודד (לדוגמה PAYMENTDEF_SUBFORM)
                    else if (!job.HasSiblings) {
                      const subformData = responseBody[subformKey];
                      console.log(
                        `Found single object subform ${subformKey}: ${typeof subformData}`
                      );

                      // אם הנתונים הם אובייקט ישיר (לא מערך)
                      if (
                        typeof subformData === "object" &&
                        subformData !== null &&
                        !Array.isArray(subformData)
                      ) {
                        if (subformData[job.priority_id] !== undefined) {
                          const idValue = subformData[job.priority_id];
                          childUpdate.priority_id =
                            idValue !== null ? String(idValue) : null;
                          // console.log(`✓ Found child ID in object: ${childUpdate.priority_id}`);
                        } else {
                          console.log(
                            `Field ${job.priority_id} not found in subform object`
                          );
                        }
                      }
                      // אם במקרה הנתונים הם מערך (למרות שהוגדר HasSiblings=false)
                      else if (
                        Array.isArray(subformData) &&
                        subformData.length > 0
                      ) {
                        if (subformData[0][job.priority_id] !== undefined) {
                          const idValue = subformData[0][job.priority_id];
                          childUpdate.priority_id =
                            idValue !== null ? String(idValue) : null;
                          // console.log(`✓ Found child ID in array item (unexpected format): ${childUpdate.priority_id}`);
                        }
                      }
                    }
                    // טיפול במקרה חריג שבו HasSiblings=true אבל התקבל אובייקט בודד
                    else if (
                      job.HasSiblings &&
                      typeof responseBody[subformKey] === "object" &&
                      !Array.isArray(responseBody[subformKey])
                    ) {
                      if (
                        responseBody[subformKey][job.priority_id] !== undefined
                      ) {
                        const idValue =
                          responseBody[subformKey][job.priority_id];
                        childUpdate.priority_id =
                          idValue !== null ? String(idValue) : null;
                        // console.log(`✓ Found child ID in direct object (unexpected format): ${childUpdate.priority_id}`);
                      }
                    }
                  }
                  // אם לא נמצא תת-מבנה בתשובה, בדוק אם המזהה קיים ישירות בשורש
                  else {
                    // console.log(`⚠️ Subform ${subformKey} not found in response. Available keys: ${Object.keys(responseBody).join(', ')}`);

                    // בדיקה אם המזהה קיים ברמה העליונה של התשובה
                    if (responseBody[job.priority_id] !== undefined) {
                      const idValue = responseBody[job.priority_id];
                      childUpdate.priority_id =
                        idValue !== null ? String(idValue) : null;
                      console.log(
                        `Found child ID at root level: ${childUpdate.priority_id}`
                      );
                    }
                  }

                  // תיעוד סופי של המזהה שהתקבל
                  // console.log(`Final priority_id for child record (RowId ${childRecord.RowId}): ${childUpdate.priority_id}`);
                } catch (e) {
                  console.error(
                    `Error extracting child ID for ${jobTypeName}:`,
                    e
                  );
                }
              } else {
                // console.log(`No job.priority_id defined for child job ${jobTypeName} or no response body`);
              }

              childUpdateRows.push(childUpdate);
            });
          } else {
            // console.log(`No valid child records found for job ${jobTypeName} - parent record RowId: ${record.RowId}`);
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
