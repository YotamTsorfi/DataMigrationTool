// connection.ts
import sql from "mssql";
import { config } from "../config/config";

export const connectToCarmeltonDatabase = async () => {
  try {
    await sql.connect(config.db);
    console.log("Connected to SQL Server successfully.");
  } catch (err) {
    console.error("Error connecting to SQL Server:", err);
  }
};

export default sql;
