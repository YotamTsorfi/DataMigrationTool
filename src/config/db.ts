// db.ts

import sql from "mssql";
import { config } from "./config";

export const poolPromise = new sql.ConnectionPool(config.db)
  .connect()
  .then((pool) => {
    console.log("Connected to MSSQL");
    return pool;
  })
  .catch((err) => {
    console.error("Database Connection Failed! Bad Config: ", err);
    return null;
  });
