import { poolPromise } from "../../config/db";
import { configService } from "../../config/configService";
import sql from "mssql";
import PerformanceMonitor from "../../utils/performanceMonitor";

declare module "mssql" {
  interface IColumn {
    length?: number;
    precision?: number;
    scale?: number;
  }

  interface IColumnOptions {
    precision?: number;
    scale?: number;
  }
}

// Define interface for table-valued parameters
interface TableValuedParameter {
  tvpType: string;
  tvpValue: Record<string, any>[];
}

// Type guard function to check if an object is a TVP
function isTVP(value: any): value is TableValuedParameter {
  return (
    value &&
    typeof value === "object" &&
    typeof value.tvpType === "string" &&
    Array.isArray(value.tvpValue)
  );
}

export class DatabaseService {
  // Cache for table schemas to avoid re-creating them
  private static tableSchemaCache: Map<string, sql.Table> = new Map();

  //---------------------------------------------
  private static async getPool(): Promise<sql.ConnectionPool> {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Failed to connect to the database");
    }
    return pool;
  }
  //--------------------------------------------------------------------------------
  static async executeQuery<T>(query: string, inputs?: any): Promise<T[]> {
    const pool = await this.getPool();
    const request = pool.request();

    if (inputs) {
      Object.entries(inputs).forEach(([key, value]) => {
        request.input(key, value);
      });
    }

    const result = await request.query(query);
    return result.recordset;
  }

  //--------------------------------------------------------------------------------
  // Creates or retrieves a cached table schema based on the provided TVP type and sample data
  private static getOrCreateTableSchema(
    tvpType: string,
    sampleData: Record<string, any>
  ): sql.Table {
    const cacheKey = `${tvpType}`;

    if (this.tableSchemaCache.has(cacheKey)) {
      const cachedTable = this.tableSchemaCache.get(cacheKey)!;
      const newTable = new sql.Table(tvpType);

      // Copy columns from the cached table to the new table
      cachedTable.columns.forEach((column) => {
        // Create an options object with only the properties that exist on the column
        const options: sql.IColumnOptions = {
          nullable: column.nullable,
        };

        // Check for additional properties and add them if they exist
        if ("length" in column) {
          options.length = (column as any).length;
        }

        if ("precision" in column) {
          options.precision = (column as any).precision;
        }

        if ("scale" in column) {
          options.scale = (column as any).scale;
        }

        newTable.columns.add(column.name, column.type as sql.ISqlType, options);
      });

      return newTable;
    }

    // If not cached, create a new table schema
    const table = new sql.Table(tvpType);
    const columns = Object.keys(sampleData);

    columns.forEach((colName) => {
      const sampleValue = sampleData[colName];
      this.addColumnWithAppropriateType(table, colName, sampleValue);
    });

    // Cache the created table schema
    this.tableSchemaCache.set(cacheKey, table);

    return table;
  }
  //--------------------------------------------------------------------------------
  // Sends a batch of records to the database, handling parent-child relationships
  private static addColumnWithAppropriateType(
    table: sql.Table,
    colName: string,
    sampleValue: any
  ): void {
    if (typeof sampleValue === "number") {
      this.handleNumericType(table, colName, sampleValue);
    } else if (typeof sampleValue === "boolean") {
      table.columns.add(colName, sql.Bit, { nullable: true });
    } else if (sampleValue instanceof Date) {
      table.columns.add(colName, sql.DateTime, { nullable: true });
    } else if (sampleValue === null || sampleValue === undefined) {
      table.columns.add(colName, sql.NVarChar(sql.MAX), { nullable: true });
    } else if (typeof sampleValue === "string") {
      // Check if it's a GUID
      const guidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (guidRegex.test(sampleValue)) {
        table.columns.add(colName, sql.UniqueIdentifier, { nullable: true });
      } else {
        table.columns.add(colName, sql.NVarChar(sql.MAX), { nullable: true });
      }
    } else {
      table.columns.add(colName, sql.NVarChar(sql.MAX), { nullable: true });
    }
  }
  //--------------------------------------------------------------------------------
  // Handles numeric types for table columns
  private static handleNumericType(
    table: sql.Table,
    colName: string,
    value: number
  ): void {
    if (Number.isInteger(value)) {
      if (value > 2147483647 || value < -2147483648) {
        table.columns.add(colName, sql.BigInt, { nullable: true });
      } else {
        table.columns.add(colName, sql.Int, { nullable: true });
      }
    } else {
      const stringValue = value.toString();
      const parts = stringValue.split(".");

      if (parts.length > 1) {
        const decimalPlaces = parts[1].length;
        if (decimalPlaces > 7) {
          table.columns.add(colName, sql.Decimal(18, decimalPlaces), {
            nullable: true,
          });
        } else {
          table.columns.add(colName, sql.Float, { nullable: true });
        }
      } else {
        table.columns.add(colName, sql.Float, { nullable: true });
      }
    }
  }
  //--------------------------------------------------------------------------------
  static async executeBulkOperation<T>(
    procedureName: string,
    params: Record<string, any>,
    tvpParam: string,
    tvpType: string,
    data: any[],
    batchSize?: number,
    maxRetries?: number,
    batchId?: string
  ): Promise<{
    success: boolean;
    retryCount: number;
    deadlockDetected: boolean;
  }> {
    if (data.length === 0)
      return { success: true, retryCount: 0, deadlockDetected: false };

    // Get configuration values
    const config = await configService.getConfig();

    // Use provided values or fallback to config
    const effectiveBatchSize = batchSize || config.DB_BATCH_SIZE;
    const effectiveMaxRetries = maxRetries || config.MAX_RETRIES;

    let hadDeadlock = false;
    let totalRetries = 0;

    // Process in optimal chunks
    for (let i = 0; i < data.length; i += effectiveBatchSize) {
      const batch = data.slice(i, i + effectiveBatchSize);
      const batchParams = { ...params };
      batchParams[tvpParam] = {
        tvpType: tvpType,
        tvpValue: batch,
      };

      let retries = 0;
      let success = false;

      // Get batch identifier for logs
      const batchIdentifier = batchId ? `batch ${batchId}` : "batch";

      while (!success && retries < effectiveMaxRetries) {
        try {
          await this.executeStoredProcedure(procedureName, batchParams);
          // console.log(`Batch ${i}-${i + batch.length} processed successfully.`);
          success = true;
        } catch (error: any) {
          // Specific deadlock detection
          const isDeadlock =
            error?.number === 1205 ||
            error?.originalError?.info?.number === 1205 ||
            (error instanceof Error && error.message.includes("deadlock"));

          // Check for transaction abort errors too
          const isTransactionAbort =
            (error instanceof Error &&
              error.message.includes("Transaction has been aborted")) ||
            (error as any)?.code === "EABORT";

          retries++;
          totalRetries += 1;

          if (isDeadlock || isTransactionAbort) {
            hadDeadlock = true;
            console.log(
              `❗ ${isDeadlock ? "Database deadlock" : "Transaction abort"} detected in Batch ${batchIdentifier}. Retry attempt ${retries}/${effectiveMaxRetries}...`
            );
          } else {
            // Truncate very long error messages
            const errorMsg =
              error instanceof Error
                ? error.message.length > 200
                  ? error.message.substring(0, 200) + "..."
                  : error.message
                : "Unknown error";

            console.error(
              `❌ Error in Batch ${batchIdentifier}, retry ${retries}/${effectiveMaxRetries}: ${errorMsg}`
            );
          }

          if (retries >= effectiveMaxRetries) {
            console.error(
              `⛔ Maximum retries (${effectiveMaxRetries}) reached for ${batchIdentifier}. Giving up.`
            );
            throw error;
          }

          // Randomized exponential backoff for retries
          const baseDelay = 100 * Math.pow(2, retries);
          const jitter = Math.floor(Math.random() * 100);
          const totalDelay = baseDelay + jitter;

          console.log(
            `⏱️ Waiting ${Math.round((totalDelay / 1000) * 10) / 10} seconds before retry...`
          );
          await new Promise((resolve) => setTimeout(resolve, totalDelay));
        }
      }
    }

    // Return information about the execution
    return {
      success: true,
      retryCount: totalRetries,
      deadlockDetected: hadDeadlock,
    };
  }

  //--------------------------------------------------------------------------------
  static async executeTransaction(
    operations: (transaction: sql.Transaction) => Promise<void>
  ): Promise<void> {
    const pool = await this.getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();
      await operations(transaction);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  //--------------------------------------------------------------------------------
  static async executeStoredProcedure<T>(
    procedureName: string,
    params?: Record<string, any>,
    isolationLevel: sql.IIsolationLevel = sql.ISOLATION_LEVEL.READ_COMMITTED
  ): Promise<T[]> {
    const pool = await this.getPool();
    const transaction = new sql.Transaction(pool);
    let transactionStarted = false;

    try {
      await transaction.begin(isolationLevel);
      transactionStarted = true;

      const request = new sql.Request(transaction);

      // Add parameters
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (key !== "procedure") {
            if (isTVP(value)) {
              // TVP handling...
              if (value.tvpValue.length > 0) {
                const firstRow = value.tvpValue[0];
                const table = this.getOrCreateTableSchema(
                  value.tvpType,
                  firstRow
                );
                const columns = Object.keys(firstRow);

                value.tvpValue.forEach((row: any) => {
                  const rowValues = columns.map((col) => row[col]);
                  table.rows.add(...rowValues);
                });

                request.input(key, table);
              } else {
                const table = new sql.Table(value.tvpType);
                request.input(key, table);
              }
            } else {
              // Regular parameter
              request.input(key, value);
            }
          }
        });
      }

      const result = await request.execute(procedureName);
      await transaction.commit();
      transactionStarted = false;
      return result.recordset || [];
    } catch (error) {
      try {
        // Only attempt to roll back if the transaction was started
        if (transactionStarted) {
          // Silent rollback - we'll handle the original error,
          // not the rollback errors which can be expected in deadlock situations
          await transaction.rollback().catch(() => {
            // Intentionally empty - we're suppressing rollback errors
          });
        }
      } catch (rollbackError) {
        // Suppressed - no logging needed, just catch it
      }

      // Identify specific database errors
      const isDeadlock =
        error instanceof Error &&
        (error.message.includes("deadlock") ||
          (error as any)?.number === 1205 ||
          (error as any)?.originalError?.info?.number === 1205);

      if (isDeadlock) {
        // For deadlocks, we don't need to log since they're normal and will be retried
        // Just rethrow for the retry logic
        throw error;
      } else {
        // Log other transaction errors with more details
        console.error(`Transaction error in procedure: ${procedureName}`, {
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  code: (error as any).code,
                  name: error.name,
                }
              : "Unknown error type",
        });
        throw error;
      }
    }
  }
  //--------------------------------------------------------------------------------
  /**
   * Sanitizes update data to ensure SQL compatibility
   * @param updates Array of update objects
   * @returns Sanitized update array
   */
  static sanitizeForSqlUpdate(updates: any[]): any[] {
    return updates.map((update) => {
      // Ensure all fields are strings or numbers, and handle nulls
      return {
        RowId: update.RowId,
        BatchId: update.BatchId,
        JobName: update.JobName,
        Status: update.Status,
        Error: update.Error || update.ErrorMessage || null,
        CleanError: update.CleanError || null,
        JobId: update.JobId,
        priority_id:
          update.priority_id === undefined
            ? null
            : update.priority_id === null
              ? null
              : String(update.priority_id),
        is_new: update.is_new,
        StatusCode: update.StatusCode || null,
      };
    });
  }
  //--------------------------------------------------------------------------------
  /**
   * Executes a non-query SQL statement and returns the number of affected rows
   * @param query SQL statement to execute
   * @returns Number of rows affected by the operation
   */
  public static async executeNonQuery(query: string): Promise<number> {
    try {
      const pool = await this.getPool();
      const result = await pool.request().query(query);
      return result.rowsAffected[0]; // This extracts the affected row count
    } catch (error) {
      console.error("Database error executing non-query:", error);
      throw error;
    }
  }
  //--------------------------------------------------------------------------------
  /**
   * Performs bulk update of processed rows
   */
  static async performBulkUpdateWithService(
    tableName: string,
    updates: any[],
    perfMonitor?: PerformanceMonitor,
    batchSize = 500,
    maxRetries = 3,
    sentToPriority = false
  ): Promise<{
    updateTime: number;
    hadDeadlocks: boolean;
    successful: boolean;
  }> {
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
    // let successful = true;

    try {
      // Sanitize data before update
      const sanitizedRows = this.sanitizeForSqlUpdate(updates);

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
      // successful = false;

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
            // Update the status to 'Completed' with an explanatory message
            await DatabaseService.executeQuery(
              `
              UPDATE ${tableName}
              SET Status = 'Completed',
                Error = 'Completed after deadlock retry'
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
  static async performBulkErrorInsertWithService(
    errors: any[],
    perfMonitor?: PerformanceMonitor,
    batchSize = 1000, // Increased default batch size from 1000
    maxRetries = 3
  ): Promise<{
    updateTime: number;
    hadDeadlocks: boolean;
    successful: boolean;
  }> {
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
  static async recordBatchProcessing(
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
    tableName: string,
    updateBatchTable: boolean = false
  ): Promise<void> {
    // const recordStartTime = Date.now();

    try {
      // If updateBatchTable is false, skip the database update
      if (!updateBatchTable) {
        return;
      }
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

      // Check if the error is a deadlock
      const isDeadlock =
        error?.number === 1205 ||
        error?.originalError?.info?.number === 1205 ||
        (error instanceof Error && error.message.includes("deadlock"));

      if (isDeadlock) {
        // If we had a deadlock, we can retry the operation
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

    // const recordTime = Date.now() - recordStartTime;
    // console.log(`Batch processing record saved in ${recordTime}ms`);
  }
  //--------------------------------------------------------------------------------
  /**
   * Fetches paginated data chunks from the database with filtering capabilities
   *
   * Retrieves records that match the specified criteria with optimized performance.
   * This is a lower-level database function that returns raw database records.
   * including support for delta processing and parent-child relationships.
   *
   * @param tableName - The source table to query
   * @param lastRowId - The ID to start fetching from (for pagination)
   * @param chunkSize - Maximum number of records to fetch
   * @param customWhereClause - Optional additional filtering criteria
   * @param caseId - Optional case ID filter
   * @param baseWhereClause - Base filtering criteria (defaults to eligible and new records)
   * @returns Array of raw database records with RowId and Data columns
   */
  static async fetchDataChunk(
    tableName: string,
    lastRowId: number,
    chunkSize: number,
    customWhereClause?: string,
    caseId?: string,
    baseWhereClause: string = "is_eligible = 1 AND is_new = 1",
    isDelta: boolean = false,
    isChildDelta: boolean = false,
    parentTableName?: string
  ): Promise<
    Array<{
      RowId: number;
      Data: string;
      is_new?: number;
      is_modified?: number;
      priority_id?: string | null;
      reference_id?: string | null;
      parent_priority_id?: string | null;
    }>
  > {
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();

    try {
      // For delta processing, we only need is_eligible = 1
      if (isDelta) {
        baseWhereClause = "is_eligible = 1";
      }

      // Build the WHERE clause with the base condition
      let whereClause = `RowId > @lastRowId AND ${baseWhereClause}`;

      // Add case_id filter if provided
      if (caseId) {
        whereClause += " AND case_id = @caseId";
      }

      // Append custom WHERE clause if provided
      if (customWhereClause) {
        whereClause += ` AND (${customWhereClause})`;
      }

      // Select delta metadata fields for delta processing
      let selectClause = "RowId, Data";
      if (isDelta) {
        selectClause =
          "RowId, Data, is_new, is_modified, priority_id, reference_id";
      }

      const query = `
      SELECT TOP (@chunkSize) ${selectClause}
      FROM ${tableName}
      WHERE ${whereClause}
      ORDER BY RowId ASC
    `;

      // Prepare query parameters
      const params: Record<string, any> = {
        lastRowId,
        chunkSize,
      };

      if (caseId) {
        params.caseId = caseId;
      }

      // Execute the query and get base results
      const rowsData = await this.executeQuery<{
        RowId: number;
        Data: string;
        is_new?: number;
        is_modified?: number;
        priority_id?: string | null;
        reference_id?: string | null;
        parent_priority_id?: string | null;
      }>(query, params);

      // For child delta tables, fetch parent information
      if (isDelta && isChildDelta && parentTableName && rowsData.length > 0) {
        // Get all reference_ids for new child records
        const newChildRecords = rowsData.filter(
          (row: any) =>
            row.is_new === 1 && row.is_modified === 0 && row.reference_id
        );

        if (newChildRecords.length > 0) {
          const referenceIds = newChildRecords
            .map((row: any) => row.reference_id)
            .filter(Boolean);

          if (referenceIds.length > 0) {
            // Create a parameter for each reference_id to avoid SQL injection
            const referenceIdParams = referenceIds
              .map((_, idx) => `@refId${idx}`)
              .join(", ");
            const referenceIdParamsObj: Record<string, any> = {};
            referenceIds.forEach((id, idx) => {
              referenceIdParamsObj[`refId${idx}`] = id;
            });

            // Query to get parent priority_ids
            const parentQuery = `
            SELECT reference_id, priority_id 
            FROM ${parentTableName}
            WHERE reference_id IN (${referenceIdParams})
          `;

            const parentData = await this.executeQuery(
              parentQuery,
              referenceIdParamsObj
            );

            // Create a lookup map for parent priority_ids
            const parentPriorityMap = new Map();
            parentData.forEach((parent: any) => {
              if (parent.reference_id && parent.priority_id) {
                parentPriorityMap.set(parent.reference_id, parent.priority_id);
              }
            });

            // Enrich child records with parent priority_ids
            rowsData.forEach((row: any) => {
              if (
                row.is_new === 1 &&
                row.is_modified === 0 &&
                row.reference_id
              ) {
                const parentPriorityId = parentPriorityMap.get(
                  row.reference_id
                );
                if (parentPriorityId) {
                  row.parent_priority_id = parentPriorityId;
                }
              }
            });
          }
        }
      }

      perfMonitor.endDbFetch();
      return rowsData;
    } catch (error) {
      perfMonitor.logError(error);
      console.error("Error in DatabaseService.fetchDataChunk:", error);
      throw error;
    }
  }
}
