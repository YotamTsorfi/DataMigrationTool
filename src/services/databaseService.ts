import { poolPromise } from "../config/db";
import { configService } from "../config/configService";
import sql from "mssql";

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
  // מטמון סכמות טבלאות
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
    let request = pool.request();

    if (inputs) {
      Object.entries(inputs).forEach(([key, value]) => {
        request.input(key, value);
      });
    }

    const result = await request.query(query);
    return result.recordset;
  }

  //--------------------------------------------------------------------------------
  // מתודה לקבלת או יצירת סכמת טבלה
  private static getOrCreateTableSchema(
    tvpType: string,
    sampleData: Record<string, any>
  ): sql.Table {
    const cacheKey = `${tvpType}`;

    if (this.tableSchemaCache.has(cacheKey)) {
      const cachedTable = this.tableSchemaCache.get(cacheKey)!;
      const newTable = new sql.Table(tvpType);

      // העתק את הגדרות העמודות מהמבנה הקיים תוך התייחסות לבעיות טיפוס
      cachedTable.columns.forEach((column) => {
        // יצירת אובייקט אפשרויות עם רק תכונות שקיימות בפועל
        const options: sql.IColumnOptions = {
          nullable: column.nullable,
        };

        // הוספת תכונות אופציונליות רק אם קיימות בפועל
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

    // אחרת, צור מבנה חדש
    const table = new sql.Table(tvpType);
    const columns = Object.keys(sampleData);

    columns.forEach((colName) => {
      const sampleValue = sampleData[colName];
      this.addColumnWithAppropriateType(table, colName, sampleValue);
    });

    // שמור במטמון לשימוש עתידי
    this.tableSchemaCache.set(cacheKey, table);

    return table;
  }
  //--------------------------------------------------------------------------------
  // טיפול בסוגי נתונים שונים
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
  // טיפול בטיפוסי מספרים
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
    maxRetries?: number
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
              `❗ ${isDeadlock ? "Database deadlock" : "Transaction abort"} detected in batch ${i}-${i + batch.length}. Retry attempt ${retries}/${effectiveMaxRetries}...`
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
              `❌ Error in batch ${i}-${i + batch.length}, retry ${retries}/${effectiveMaxRetries}: ${errorMsg}`
            );
          }

          if (retries >= effectiveMaxRetries) {
            console.error(
              `⛔ Maximum retries (${effectiveMaxRetries}) reached for batch ${i}-${i + batch.length}. Giving up.`
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
    let transaction = new sql.Transaction(pool);
    let transactionStarted = false;

    try {
      await transaction.begin(isolationLevel);
      transactionStarted = true;

      let request = new sql.Request(transaction);

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
}