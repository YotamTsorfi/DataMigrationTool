import { DatabaseService } from "./databaseService";

/**
 * Fetches a chunk of data from the database that needs processing
 */
export async function fetchDataChunk(tableName: string, lastRowId: number, chunkSize: number): Promise<any[]> {
  const query = `
    SELECT TOP (${chunkSize}) RowId, Data
    FROM ${tableName}
    WHERE Status IS NULL AND RowId > ${lastRowId}
    ORDER BY RowId ASC
  `;

  try {
    const rowsData = await DatabaseService.executeQuery(query);
    return rowsData.map((record: any) => ({
      RowId: record.RowId,
      ...JSON.parse(record.Data),
    }));
  } catch (error) {
    console.error("Error fetching data chunk:", error);
    throw error;
  }
}

/**
 * Performs bulk update of processed rows
 */
export async function performBulkUpdateWithService(
  tableName: string,
  updates: any[],
  batchSize = 1000,
  maxRetries = 3
): Promise<void> {
  if (updates.length === 0) return;

  try {
    await DatabaseService.executeBulkOperation(
      "dbo.BulkUpdateRows",
      { TableName: tableName },
      "Updates",
      "dbo.BatchUpdateTableType",
      updates,
      batchSize
    );
  } catch (error) {
    console.error(`Error performing bulk update:`, error);
    throw error;
  }
}

/**
 * Performs bulk insertion of error logs
 */
export async function performBulkErrorInsertWithService(
  errors: any[],
  batchSize = 1000,
  maxRetries = 3
): Promise<void> {
  if (errors.length === 0) return;

  try {
    await DatabaseService.executeBulkOperation(
      "dbo.BulkInsertErrorLogs",
      {}, // No additional parameters
      "Errors",
      "dbo.ErrorLogTableType",
      errors,
      batchSize
    );
  } catch (error) {
    console.error(`Error performing bulk error insert:`, error);
    throw error;
  }
}

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
  await DatabaseService.executeQuery(
    `
    INSERT INTO PriorityBatchProcessing (JobName, BatchID, StartTime, EndTime, TotalRecords, SuccessCount, FailureCount, LastProcessedIndex, Status, ErrorMessage, TableName, JobID)
    VALUES (@JobName, @BatchID, @StartTime, @EndTime, @TotalRecords, @SuccessCount, @FailureCount, @LastProcessedIndex, @Status, @ErrorMessage, @TableName, @JobID)
  `,
    {
      JobName: jobType,
      BatchID: batchId,
      JobID: jobId,
      StartTime: startTime,
      EndTime: endTime,
      TotalRecords: totalRecords,
      SuccessCount: successCount,
      FailureCount: failureCount,
      LastProcessedIndex: lastProcessedIndex,
      Status: status,
      ErrorMessage: errorMessage,
      TableName: tableName,
    }
  );
}
