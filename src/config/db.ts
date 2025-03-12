import sql from "mssql";
import { config } from "./config";

const poolConfig = {
  ...config.db,
  min: 5,
  max: 30, // Increase max connections
  idleTimeoutMillis: 30000,
  connectionTimeout: 15000,
  requestTimeout: 60000, // Increase request timeout
  pool: {
    acquireTimeoutMillis: 30000, // Timeout for acquiring a connection
    createTimeoutMillis: 30000, // Timeout for creating a new connection
    destroyTimeoutMillis: 5000, // Timeout for destroying a connection
    idleTimeoutMillis: 30000, // How long a connection can be idle before being removed
    reapIntervalMillis: 1000, // How frequently to check for idle connections
    createRetryIntervalMillis: 200, // Time between connection creation retries
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
