import { DatabaseService } from "./databaseService";
import PerformanceMonitor from "../utils/performanceMonitor";
//--------------------------------------------------------------------------------
/**
 * Fetches a chunk of data from the database that needs processing
 */
export async function fetchDataChunk(
  tableName: string,
  lastRowId: number,
  chunkSize: number
): Promise<any[]> {
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startDbFetch();

  const query = `
    SELECT TOP (${chunkSize}) RowId, Data
    FROM ${tableName}
    WHERE           
    RowId > ${lastRowId}
    AND
    is_eligible = 1
    AND
    is_new = 1
    AND 
    Status IS NULL 
    -- AND Status != 'Completed'
    ORDER BY RowId ASC
  `;

  try {
    // console.log(
    //   `Fetching data chunk: lastRowId=${lastRowId}, chunkSize=${chunkSize}, table=${tableName}`
    // );
    const startTime = Date.now();

    const rowsData = await DatabaseService.executeQuery(query);

    const fetchTime = Date.now() - startTime;
    // console.log(
    //   `Database query completed in ${fetchTime}ms, returned ${rowsData.length} rows`
    // );

    perfMonitor.endDbFetch();

    return rowsData.map((record: any) => ({
      RowId: record.RowId,
      ...JSON.parse(record.Data),
    }));
  } catch (error) {
    perfMonitor.logError(error);
    console.error("Error fetching data chunk:", error);
    throw error;
  }
}
//--------------------------------------------------------------------------------
/**
 * Sanitizes update data to ensure SQL compatibility
 * @param updates Array of update objects
 * @returns Sanitized update array
 */
export function sanitizeForSqlUpdate(updates: any[]): any[] {
  return updates.map(update => {
    // Create a new object to avoid modifying the original
    const sanitized = { ...update };
    
    // Ensure priority_id is either a string or null (never undefined)
    if (sanitized.priority_id === undefined) {
      sanitized.priority_id = null;
    } else if (sanitized.priority_id !== null) {
      sanitized.priority_id = String(sanitized.priority_id);
    }
    
    // Ensure ErrorMessage is either a string or null
    if (sanitized.ErrorMessage !== null && sanitized.ErrorMessage !== undefined) {
      sanitized.ErrorMessage = String(sanitized.ErrorMessage);
    } else {
      sanitized.ErrorMessage = null;
    }
    
    return sanitized;
  });
}

//--------------------------------------------------------------------------------
/**
 * Performs bulk update of processed rows
 */
export async function performBulkUpdateWithService(
  tableName: string,
  updates: any[],
  perfMonitor?: PerformanceMonitor,
  batchSize = 1000,
  maxRetries = 3,
  sentToPriority = false
): Promise<{ updateTime: number; hadDeadlocks: boolean; successful: boolean }> {
  // Return the time taken for the operation and status info
  if (updates.length === 0)
    return { updateTime: 0, hadDeadlocks: false, successful: true };

  const localPerfMonitor = perfMonitor || new PerformanceMonitor();
  if (!perfMonitor) localPerfMonitor.startOperation();

  // Process error messages to extract only the essential information
  updates.forEach((update) => {
    if (update.ErrorMessage) {
      try {
        // Check if the error message contains a JSON string
        const jsonStartIndex = update.ErrorMessage.indexOf('{"error":');
        if (jsonStartIndex !== -1) {
          // Extract and parse the JSON part
          const jsonPart = update.ErrorMessage.substring(jsonStartIndex);
          const errorObj = JSON.parse(jsonPart);

          // Get the detailed message if available
          if (errorObj.error && errorObj.error.message) {
            update.ErrorMessage = errorObj.error.message;
            console.log(
              `Extracted detailed error message: ${update.ErrorMessage}`
            );
          }
        }
      } catch (parseError) {
        console.log(`Error parsing error message JSON: ${parseError}`);
        // Keep the original message if parsing fails
      }
    }
  });

  localPerfMonitor.startDbUpdate();
  let hadDeadlocks = false;
  let successful = true;

  try {
    // Sanitize data before update
    const sanitizedRows = sanitizeForSqlUpdate(updates);

    // Execute bulk update operation - no need to check for columns here
    // as the stored procedure now handles the priority_id field check
    const result = await DatabaseService.executeBulkOperation(
      "dbo.BulkUpdateRows",
      { TableName: tableName },
      "Updates",
      "dbo.BatchUpdateTableType",
      sanitizedRows,
      batchSize
    );

    // Track if we had deadlocks during the operation
    hadDeadlocks = result.deadlockDetected;

    localPerfMonitor.endDbUpdate();
    const updateTime = localPerfMonitor.metrics.dbUpdateTime || 0;

    if (hadDeadlocks) {
      console.log(
        `Bulk update completed with ${result.retryCount} retries due to deadlocks. All updates successful.`
      );
    }

    return { updateTime, hadDeadlocks, successful: true };
  } catch (error: any) {
    console.error(`Error performing bulk update:`, error);

    // check if the error is a deadlock
    const isDeadlock =
      error?.number === 1205 ||
      error?.originalError?.info?.number === 1205 ||
      (error instanceof Error && error.message.includes("deadlock"));

    hadDeadlocks = isDeadlock;
    successful = false;

    const isConnectionError =
      error?.code === "ECONNRESET" ||
      error?.code === "ETIMEDOUT" ||
      (error instanceof Error && error.message.includes("connection"));

    if (isConnectionError) {
      console.log(
        "Database connection error detected. Will retry operation..."
      );
    }

    if (isDeadlock && sentToPriority) {
      console.log(
        "Deadlock detected after successful Priority update. Using 'Completed' status with explanatory message..."
      );

      // Update to use accepted status value
      for (const update of updates) {
        try {
          // עדכון טבלת המקור
          await DatabaseService.executeQuery(
            `
            UPDATE ${tableName}
            SET Status = 'Completed',
              ErrorMessage = 'Completed after deadlock retry'
            WHERE RowId = @RowId
          `,
            {
              RowId: update.RowId,
            }
          );
        } catch (innerError) {
          console.error(
            `Failed to update source record ${update.RowId} status:`,
            innerError
          );
        }
      }

      // Return with special status for PartialSync
      localPerfMonitor.endDbUpdate();
      return {
        updateTime: localPerfMonitor.metrics.dbUpdateTime || 0,
        hadDeadlocks: true,
        successful: true, // Mark as successful since we handled it properly
      };
    }

    throw error;
  } finally {
    if (!perfMonitor) localPerfMonitor.endOperation();
  }
}
//--------------------------------------------------------------------------------
/**
 * Performs bulk insertion of error logs
 */
export async function performBulkErrorInsertWithService(
  errors: any[],
  perfMonitor?: PerformanceMonitor,
  batchSize = 1000, // Increased default batch size from 1000
  maxRetries = 3
): Promise<{ updateTime: number; hadDeadlocks: boolean; successful: boolean }> {
  // Return the time taken
  if (errors.length === 0)
    return { updateTime: 0, hadDeadlocks: false, successful: true };

  const localPerfMonitor = perfMonitor || new PerformanceMonitor();
  if (!perfMonitor) localPerfMonitor.startOperation();

  // Process error messages for error log entries - reduce sample size for better performance
  const sampleSize = Math.min(5, errors.length);
  for (let i = 0; i < sampleSize; i++) {
    const errorEntry = errors[i];
    if (errorEntry.Error) {
      try {
        // Check if the error contains a JSON string with error details
        const jsonStartIndex = errorEntry.Error.indexOf('{"error":');
        if (jsonStartIndex !== -1) {
          // Extract and parse the JSON part
          const jsonPart = errorEntry.Error.substring(jsonStartIndex);
          const errorObj = JSON.parse(jsonPart);

          // Get the detailed message if available
          if (errorObj.error && errorObj.error.message) {
            errorEntry.Error = errorObj.error.message;
            // Use debug level to reduce console output
            console.debug(
              `Extracted detailed error message for log: ${errorEntry.Error}`
            );
          }
        }
      } catch (parseError) {
        console.debug(`Error parsing error log JSON: ${parseError}`);
        // Keep the original message if parsing fails
      }
    }
  }

  localPerfMonitor.startDbUpdate();
  let hadDeadlocks = false;

  try {
    // Generate batch identifier for better error tracing
    const batchId = `err-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    
    const result = await DatabaseService.executeBulkOperation(
      "dbo.BulkInsertErrorLogs",
      {}, // No additional parameters
      "Errors",
      "dbo.ErrorLogTableType",
      errors,
      batchSize, 
      maxRetries,
      batchId // Pass batch identifier for better logging
    );

    // Track if we had deadlocks
    hadDeadlocks = result.deadlockDetected;

    localPerfMonitor.endDbUpdate();
    const insertTime = localPerfMonitor.metrics.dbUpdateTime || 0;

    // Only log this for larger batches to reduce console spam
    if (errors.length > 100) {
      console.log(
        `Bulk error insert completed in ${insertTime.toFixed(2)}ms for ${errors.length} error records`
      );
    } else {
      console.debug(
        `Bulk error insert: ${errors.length} records in ${insertTime.toFixed(2)}ms`
      );
    }

    return { updateTime: insertTime, hadDeadlocks, successful: true };
  } catch (error) {
    console.error(`Error performing bulk error insert:`, error);
    return { updateTime: 0, hadDeadlocks: false, successful: false };
  } finally {
    if (!perfMonitor) localPerfMonitor.endOperation();
  }
}
//--------------------------------------------------------------------------------
/**
 * Records batch processing results in the database
 */
export async function recordBatchProcessing(
  jobType: string,
  batchId: string,
  jobId: string,
  startTime: Date,
  endTime: Date,
  totalRecords: number,
  successCount: number,
  failureCount: number,
  lastProcessedIndex: number,
  status: string,
  errorMessage: string | null,
  tableName: string
): Promise<void> {
  const recordStartTime = Date.now();

  try {
    // Ensure status is correct based on success/failure/PartialSync counts
    let finalStatus = status;

    // If we have mixed results (both successes and failures)
    if (successCount > 0 && failureCount > 0) {
      finalStatus = "PartialSync";
    }
    // If all records succeeded
    else if (successCount === totalRecords) {
      finalStatus = "Completed";
    }
    // If all records failed
    else if (failureCount === totalRecords) {
      finalStatus = "Failed";
    }

    await DatabaseService.executeQuery(
      `
      INSERT INTO PriorityBatchProcessing (JobName, BatchId, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage, TableName, JobId)
      VALUES (@JobName, @BatchId, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage, @TableName, @JobId)
    `,
      {
        JobName: jobType,
        BatchId: batchId,
        JobId: jobId,
        StartTime: startTime,
        EndTime: endTime,
        TotalRecords: totalRecords,
        SuccessCount: successCount,
        FailureCount: failureCount,
        LastProcessedIndex: lastProcessedIndex,
        Status: finalStatus,
        ErrorMessage: errorMessage,
        TableName: tableName,
      }
    );
  } catch (error: any) {
    console.error(`Error recording batch processing:`, error);

    // אם הבעיה היא deadlock, נסה לעדכן את סטטוס הבאצ' בנפרד
    const isDeadlock =
      error?.number === 1205 ||
      error?.originalError?.info?.number === 1205 ||
      (error instanceof Error && error.message.includes("deadlock"));

    if (isDeadlock) {
      // נסה לרשום את הבאצ' עם סטטוס 'PartialSync'
      try {
        await DatabaseService.executeQuery(
          `
          INSERT INTO PriorityBatchProcessing (JobName, BatchId, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage, TableName, JobId)
          VALUES (@JobName, @BatchId, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage, @TableName, @JobId)
        `,
          {
            JobName: jobType,
            BatchId: batchId,
            JobId: jobId,
            StartTime: startTime,
            EndTime: endTime,
            TotalRecords: totalRecords,
            SuccessCount: totalRecords, // Count all as success
            FailureCount: 0, // No failures
            LastProcessedIndex: lastProcessedIndex,
            Status: "PartialSync",
            ErrorMessage:
              "DB update failed due to deadlock after Priority success",
            TableName: tableName,
          }
        );
      } catch (retryError) {
        console.error(
          `Failed to record batch with PartialSync status:`,
          retryError
        );
      }
    }
  }

  const recordTime = Date.now() - recordStartTime;
  // console.log(`Batch processing record saved in ${recordTime}ms`);
}
