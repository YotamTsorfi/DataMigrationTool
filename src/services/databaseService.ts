import { poolPromise } from "../config/db";
import sql from "mssql";

// Define interface for table-valued parameters
interface TableValuedParameter {
  tvpType: string;
  tvpValue: Record<string, any>[];
}

// Type guard function to check if an object is a TVP
function isTVP(value: any): value is TableValuedParameter {
  return value && typeof value === 'object' && 
         typeof value.tvpType === 'string' && 
         Array.isArray(value.tvpValue);
}

export class DatabaseService {
  private static async getPool(): Promise<sql.ConnectionPool> {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Failed to connect to the database");
    }
    return pool;
  }

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

  static async executeStoredProcedure<T>(
    procedureName: string,
    params?: Record<string, any>
  ): Promise<T[]> {
    const pool = await this.getPool();
    let request = pool.request();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (key !== "procedure") {
          // Check if this is a TVP parameter using the type guard
          if (isTVP(value)) {
            // Create a table-valued parameter
            const table = new sql.Table(value.tvpType);

            // Add columns based on the first row's structure
            if (value.tvpValue.length > 0) {
              const firstRow = value.tvpValue[0];
              const columns = Object.keys(firstRow);

              columns.forEach((colName) => {
                const sampleValue = firstRow[colName];
                
                // Properly handle SQL types with appropriate types
                if (typeof sampleValue === "number") {
                  table.columns.add(colName, sql.Int, { nullable: true });
                } else if (typeof sampleValue === "boolean") {
                  table.columns.add(colName, sql.Bit, { nullable: true });
                } else if (sampleValue instanceof Date) {
                  table.columns.add(colName, sql.DateTime, { nullable: true });
                } else if (sampleValue === null || sampleValue === undefined) {
                  // Default to NVarChar(MAX) for null values
                  table.columns.add(colName, sql.NVarChar(sql.MAX), { nullable: true });
                } else if (typeof sampleValue === "string") {
                  // Check if it's a GUID
                  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                  if (guidRegex.test(sampleValue)) {
                    table.columns.add(colName, sql.UniqueIdentifier, { nullable: true });
                  } else {
                    // Use NVarChar with MAX length for strings
                    table.columns.add(colName, sql.NVarChar(sql.MAX), { nullable: true });
                  }
                } else {
                  // Default for other types
                  table.columns.add(colName, sql.NVarChar(sql.MAX), { nullable: true });
                }
              });

              // Add rows to the table
              value.tvpValue.forEach((row: any) => {
                const rowValues = columns.map((col) => row[col]);
                table.rows.add(...rowValues);
              });
            }

            request.input(key, table);
          } else {
            // Regular parameter
            request.input(key, value);
          }
        }
      });
    }

    const result = await request.execute(procedureName);
    return result.recordset || [];
  }
}