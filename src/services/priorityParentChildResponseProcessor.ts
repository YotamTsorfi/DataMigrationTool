import PerformanceMonitor from "../utils/performanceMonitor";
import { writeToLogFile } from "../config/logger";
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
    try {
      // Measure response performance
      measureResponsePerformance(response, perfMonitor);
  
      // Process API response
      const {
        parentUpdateRows,
        childUpdateRows,
        errorRows,
        successCount,
        failureCount,
        lastProcessedIndex,
        sentToPriority
      } = processApiResponse(response, enrichedRecords, priorityIdField, childJobs);

      // Update performance metrics
      perfMonitor.metrics.successCount = successCount;
      perfMonitor.metrics.failureCount = failureCount;
      perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;
  
      // Database update tracking
      let totalDbUpdateTime = 0;
      let batchStatus = sentToPriority ? "Completed" : "Failed";
      let hadDeadlocks = false;
  
      // Update parent records
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
            batchStatus = "Completed";
            console.log(`Batch ${batchId} had deadlocks during parent DB update but completed successfully`);
          }
        } catch (dbError) {
          // Error handling as before
          console.error("Error during parent database update:", dbError);
          // Handle errors, deadlocks, etc.
        }
      }
  
      // Update child records - group by table name for efficiency
      if (childUpdateRows.length > 0) {
        try {
          // Group child updates by table name
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
          for (const [tableName, updates] of Object.entries(childUpdatesByTable)) {            
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
          }
        } catch (childDbError) {
          console.error("Error during child database update:", childDbError);
          // Handle errors, deadlocks, etc.
        }
      }
  
      // Insert error logs
      if (errorRows.length > 0) {
        try {
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
        new Date(perfMonitor.metrics.startTime),
        new Date(perfMonitor.metrics.endTime),
        enrichedRecords.length,
        perfMonitor.metrics.successCount,
        perfMonitor.metrics.failureCount,
        perfMonitor.metrics.lastProcessedIndex,
        batchStatus,
        hadDeadlocks ? "DB update had deadlocks but completed successfully" : null,
        parentTable
      );
  
      // Return success result
      return {
        success: true,
        message: "Batch processed successfully",
        successCount: perfMonitor.metrics.successCount,
        failureCount: perfMonitor.metrics.failureCount,
        responseCount: response.data?.responses?.length || 0,
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
      // Error handling as before
      console.error("Error processing parent-child response:", error);
      return {
        // Error result object
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
      
      // Add error log entry
      errorRows.push({
        JobName: record.__jobType,
        BatchId: record.__batchId,
        TableName: record.__tableName,
        RowId: record.RowId,
        Error: safeParentErrorMessage,
        JobId: record.__jobId,
        ErrorStatus: "Failed"
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