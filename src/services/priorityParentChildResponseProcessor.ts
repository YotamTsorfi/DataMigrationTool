import PerformanceMonitor from "../utils/performanceMonitor";
// import { writeToLogFile } from "../config/logger";
import { measureResponsePerformance } from "../services/requestSender";
import {
  performBulkUpdateWithService,
  performBulkErrorInsertWithService,
  recordBatchProcessing,
} from "../services/dataService";
import { ChildJob } from "../jobs/jobParentAndChilds";
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
  console.log(`Processing response for ${enrichedRecords.length} records from ${parentTable}`);
  console.log(`Response status: ${response?.status || 'unknown'}, has data: ${!!response?.data}`);
  
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

    // IMPORTANT: If API failed but we didn't capture failures in processing,
    // make sure we mark all records as failed
    if (apiErrorMessage && failureCount === 0) {
      console.log(`API returned error but no failures detected. Marking all ${enrichedRecords.length} records as failed`);
      
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
        console.log(`Updating ${parentUpdateRows.length} parent records in table ${parentTable}`);
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
          console.log(`Batch ${batchId} had deadlocks during parent DB update but completed successfully`);
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
        console.log(`Updating child records in ${Object.keys(childUpdatesByTable).length} tables`);
        for (const [tableName, updates] of Object.entries(childUpdatesByTable)) {
          console.log(`Updating ${updates.length} records in child table ${tableName}`);
          
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

    // Insert error logs - always do this, especially important with API errors
    if (errorRows.length > 0) {
      try {
        console.log(`Inserting ${errorRows.length} error records`);
        const errorResult = await performBulkErrorInsertWithService(
          errorRows,
          perfMonitor
        );
        totalDbUpdateTime += errorResult.updateTime;
      } catch (errorInsertError) {
        console.error("Failed to insert error logs:", errorInsertError);
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

    console.log(`Batch ${batchId} processing completed: ${successCount} successful, ${perfMonitor.metrics.failureCount} failed`);
    
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
    console.log(`Updated ${parentUpdates.length} parent records with error status`);
  }
  
  if (errorLogs.length > 0) {
    await performBulkErrorInsertWithService(errorLogs);
    console.log(`Inserted ${errorLogs.length} error logs`);
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
      console.log(`Updated ${updates.length} records in child table ${tableName}`);
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
        priority_id: null,
        is_new: 0
      };

      // Extract Priority ID if available
      if (apiResponse.body && priorityIdField) {
        try {
          const responseBody = typeof apiResponse.body === "string"
            ? JSON.parse(apiResponse.body)
            : apiResponse.body;
          
          if (responseBody && responseBody[priorityIdField]) {
            parentUpdate.priority_id = responseBody[priorityIdField];
            console.log(`Found parent priority_id: ${parentUpdate.priority_id} from field: ${priorityIdField}`);
          }
        } catch (e) {
          console.warn(`Failed to parse response body for record ${index}`, e);
        }
      }

      parentUpdateRows.push(parentUpdate);

// Update child records with the same error
if (childJobs && record.childRecords) {
    console.log(`🔍 SUCCESS PATH: Processing child records for parent RowId: ${record.RowId}, found ${childJobs.length} child job types`);
    console.log(`Processing ${childJobs.length} child job types for record ${record.RowId} with error`);
    childJobs.forEach(job => {
        const childTableName = job.DBTableName;
        const jobTypeName = job.JobTypeName;
        
        // More robust child record lookup
        let childRecords;
        try {
          // Try to find using exact JobTypeName first
          childRecords = record.childRecords[jobTypeName];
          
          // If not found, try case-insensitive alternatives
          if (!childRecords && typeof jobTypeName === 'string') {
            // Try lowercase key
            const lcKey = jobTypeName.toLowerCase();
            if (record.childRecords[lcKey]) {
              childRecords = record.childRecords[lcKey];
              console.log(`Found child records using lowercase key: ${lcKey}`);
            }
            
            // Try uppercase key
            const ucKey = jobTypeName.toUpperCase();
            if (!childRecords && record.childRecords[ucKey]) {
              childRecords = record.childRecords[ucKey];
              console.log(`Found child records using uppercase key: ${ucKey}`);
            }
            
            // Try checking all keys case-insensitively
            if (!childRecords) {
              const keys = Object.keys(record.childRecords);
              for (const key of keys) {
                if (key.toLowerCase() === jobTypeName.toLowerCase()) {
                  childRecords = record.childRecords[key];
                  console.log(`Found child records using key case matching: ${key}`);
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.error(`Error looking up child records for job ${jobTypeName}:`, e);
        }
        
        // Use optional chaining to avoid errors with undefined childRecords
        const recordCount = childRecords?.length || 0;
        console.log(`- For job ${jobTypeName} in table ${childTableName}: found ${recordCount} child records to update with error`);
      
        // Only process child records if we found any
        if (childRecords && Array.isArray(childRecords) && childRecords.length > 0) {
          childRecords.forEach(childRecord => {
            // Ensure childRecord has a RowId
            if (!childRecord.RowId) {
              console.error(`Child record missing RowId for job ${jobTypeName}`);
              return;
            }
            
            // For successful records, there's no error message
            const childUpdate = {
              RowId: childRecord.RowId,
              BatchId: record.__batchId,
              JobName: record.__jobType,
              Status: "Completed",
              ErrorMessage: null,
              JobId: record.__jobId,
              priority_id: null,
              is_new: 0,
              tableName: childTableName
            };
            
            childUpdateRows.push(childUpdate);
            console.log(`Added child update for RowId ${childRecord.RowId} in table ${childTableName}`);
          });
        } else {
          console.warn(`No valid child records found for job ${jobTypeName} - parent record RowId: ${record.RowId}`);
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
        priority_id: null,
        is_new: 1
      });
      
      // Update child records with the same error
      if (childJobs && record.childRecords) {        
        // Log the keys available in childRecords for debugging
          
        childJobs.forEach(job => {
            const childTableName = job.DBTableName;            
            const jobTypeName = job.JobTypeName;
                        
            // Enhanced lookup with more logging
            let childRecords;
            const exactMatch = record.childRecords[jobTypeName];
            const lowercaseMatch = record.childRecords[jobTypeName.toLowerCase()];
            const uppercaseMatch = record.childRecords[jobTypeName.toUpperCase()];
            
            // Try to find child records using broader approach
            childRecords = exactMatch || lowercaseMatch || uppercaseMatch;
            
            // If still no match, try something more flexible
            if (!childRecords) {
                // Try looking for match by ScreenName or any partial key
                for (const key of Object.keys(record.childRecords)) {                
                    // Check if the key contains the screen name
                    if (key.includes(job.ScreenName) || jobTypeName.includes(key) || key.includes(jobTypeName)) {                    
                        childRecords = record.childRecords[key];
                        break;
                    }
                }
            }

            if (childRecords && Array.isArray(childRecords)) {
                childRecords.forEach(childRecord => {
                // Ensure errorMessage is always a string
                const safeErrorMessage = typeof errorMessage === 'string' 
                ? errorMessage 
                : errorMessage ? JSON.stringify(errorMessage) : "Unknown error";

                // Create the childUpdate object FIRST
                const childUpdate = {
                    RowId: childRecord.RowId,
                    BatchId: record.__batchId,
                    JobName: record.__jobType,
                    Status: "Failed",
                    ErrorMessage: safeErrorMessage,
                    JobId: record.__jobId,
                    priority_id: null,
                    is_new: 1,
                    tableName: childTableName
                };

              // THEN try to extract and set priority_id        
                if (apiResponse.body && job.priority_id) {
                try {
                    const responseBody = typeof apiResponse.body === "string"
                    ? JSON.parse(apiResponse.body)
                    : apiResponse.body;
                    
                    if (responseBody && responseBody[job.priority_id]) {
                    childUpdate.priority_id = responseBody[job.priority_id];
                    console.log(`Found child priority_id: ${childUpdate.priority_id} from field: ${job.priority_id} for child RowId: ${childRecord.RowId}`);
                    }
                } catch (e) {
                    console.warn(`Failed to parse response body for child record`, e);
                }
                }

                // This line might be missing - verify it exists
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