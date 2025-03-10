import { poolPromise } from "../config/db";
import sql from "mssql";

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
  
  static async executeTransaction(operations: (transaction: sql.Transaction) => Promise<void>): Promise<void> {
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
  
  static async executeStoredProcedure<T>(procedureName: string, params?: any): Promise<T[]> {
    const pool = await this.getPool();
    let request = pool.request();
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (key !== 'procedure') {
          request.input(key, value);
        }
      });
    }
    
    const result = await request.execute(procedureName);
    return result.recordset;
  }
}