import { DatabaseService } from "./databaseService";
import PerformanceMonitor from "../utils/performanceMonitor";

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
    WHERE Status IS NULL AND RowId > ${lastRowId}
    ORDER BY RowId ASC
  `;

  try {
    console.log(
      `Fetching data chunk: lastRowId=${lastRowId}, chunkSize=${chunkSize}, table=${tableName}`
    );
    const startTime = Date.now();

    const rowsData = await DatabaseService.executeQuery(query);

    const fetchTime = Date.now() - startTime;
    console.log(
      `Database query completed in ${fetchTime}ms, returned ${rowsData.length} rows`
    );

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

/**
 * Performs bulk update of processed rows
 */
export async function performBulkUpdateWithService(
  tableName: string,
  updates: any[],
  perfMonitor?: PerformanceMonitor,
  batchSize = 1000,
  maxRetries = 3
): Promise<number> {
  // Return the time taken for the operation
  if (updates.length === 0) return 0;

  const localPerfMonitor = perfMonitor || new PerformanceMonitor();
  if (!perfMonitor) localPerfMonitor.startOperation();

  localPerfMonitor.startDbUpdate();

  try {
    await DatabaseService.executeBulkOperation(
      "dbo.BulkUpdateRows",
      { TableName: tableName },
      "Updates",
      "dbo.BatchUpdateTableType",
      updates,
      batchSize
    );

    localPerfMonitor.endDbUpdate();
    const updateTime = localPerfMonitor.metrics.dbUpdateTime || 0;

    console.log(
      `Bulk update completed in ${updateTime.toFixed(2)}ms for ${updates.length} rows`
    );

    return updateTime;
  } catch (error) {
    console.error(`Error performing bulk update:`, error);
    throw error;
  } finally {
    if (!perfMonitor) localPerfMonitor.endOperation();
  }
}

/**
 * Performs bulk insertion of error logs
 */
export async function performBulkErrorInsertWithService(
  errors: any[],
  perfMonitor?: PerformanceMonitor,
  batchSize = 1000,
  maxRetries = 3
): Promise<number> {
  // Return the time taken
  if (errors.length === 0) return 0;

  const localPerfMonitor = perfMonitor || new PerformanceMonitor();
  if (!perfMonitor) localPerfMonitor.startOperation();

  localPerfMonitor.startDbUpdate();

  try {
    await DatabaseService.executeBulkOperation(
      "dbo.BulkInsertErrorLogs",
      {}, // No additional parameters
      "Errors",
      "dbo.ErrorLogTableType",
      errors,
      batchSize
    );

    localPerfMonitor.endDbUpdate();
    const insertTime = localPerfMonitor.metrics.dbUpdateTime || 0;

    console.log(
      `Bulk error insert completed in ${insertTime.toFixed(2)}ms for ${errors.length} error records`
    );

    return insertTime;
  } catch (error) {
    console.error(`Error performing bulk error insert:`, error);
    throw error;
  } finally {
    if (!perfMonitor) localPerfMonitor.endOperation();
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
  const recordStartTime = Date.now();

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

  const recordTime = Date.now() - recordStartTime;
  console.log(`Batch processing record saved in ${recordTime}ms`);
}
