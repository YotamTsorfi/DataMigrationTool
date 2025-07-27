import sql from "mssql";
import { config } from "./config";

const poolConfig = {
  ...config.db,
  min: 5,
  max: 20, // Increase max connections
  idleTimeoutMillis: 18000000, // 5 hours idle timeout
  connectionTimeout: 60000, // Increased to 60 seconds for initial connections
  requestTimeout: 18000000, // 5 hours for all query operations
  pool: {
    acquireTimeoutMillis: 18000000, // 5 hours timeout for acquiring a connection
    createTimeoutMillis: 60000, // 1 minute for creating new connections
    destroyTimeoutMillis: 10000, // 10 seconds for destroying connections
    idleTimeoutMillis: 18000000, // 5 hours idle timeout within pool
    reapIntervalMillis: 1000, // Check for idle connections every 1 second
    createRetryIntervalMillis: 200, // 200ms between connection creation retries
  },
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
