// db.ts

import sql from "mssql";
import { config } from "./config";

const poolConfig = {
  ...config.db,
  min: 5, // Minimum connections in pool
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // How long a connection sits idle before being removed
  connectionTimeout: 15000, // Connection timeout
  requestTimeout: 30000, // Request timeout
};

export const poolPromise = new sql.ConnectionPool(poolConfig)
  .connect()
  .then((pool) => {
    console.log("Connected to MSSQL with optimized pool");
    return pool;
  })
  .catch((err) => {
    console.error("Database Connection Failed! Bad Config: ", err);
    return null;
  });