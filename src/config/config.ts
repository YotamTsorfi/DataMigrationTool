// src/config/config.ts

import dotenv from "dotenv";
import path from "path";
import * as fs from "fs";

const isProduction = process.env.NODE_ENV === "production";
// console.log(`Running in ${isProduction ? "PRODUCTION" : "DEVELOPMENT"} mode`);

// Check if environment variables are already set (e.g. from PM2)
let allEnvVarsPresent = true;
const requiredEnvVars = [
  "SERVER_PORT",
  "PRIORITY_BASE_URL",
  "PRIORITY_PAT",
  "PRIORITY_PASSWORD",
  "CARMELTON_DB_USER",
  "CARMELTON_DB_PASSWORD",
  "CARMELTON_DB_SERVER",
  "CARMELTON_DB_NAME",
  "CARMELTON_DB_PORT",
];

// Check if any required env vars are missing
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    allEnvVarsPresent = false;
    console.log(`Missing environment variable: ${envVar}`);
    break;
  }
}

// Only try to load .env file if variables are not already present (e.g. from PM2)
if (!allEnvVarsPresent) {
  console.log(
    "Some environment variables are missing, trying to load from .env file"
  );

  // Try to find and load .env file
  const envFile = isProduction ? ".env.production" : ".env.development";
  const possiblePaths = [
    path.resolve(process.cwd(), envFile),
    path.resolve(__dirname, "../../", envFile),
  ];

  let envLoaded = false;
  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      console.log(`Loading environment variables from: ${filePath}`);
      dotenv.config({ path: filePath });
      envLoaded = true;
      break;
    } else {
      console.log(`Env file not found at: ${filePath}`);
    }
  }

  if (!envLoaded) {
    console.warn("Could not find any .env file!");
  }
}

// Final check to ensure all variables are set
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is not defined in the environment variables.`);
  }
});

// Log confirmation that we have all required variables
console.log("All required environment variables are set");
console.log(`Using server port: ${process.env.SERVER_PORT}`);

export const config = {
  priorityDEVBaseUrl: process.env.PRIORITY_BASE_URL!,
  priorityPAT: process.env.PRIORITY_PAT!,
  priorityPassword: process.env.PRIORITY_PASSWORD!,

  db: {
    user: process.env.CARMELTON_DB_USER!,
    password: process.env.CARMELTON_DB_PASSWORD!,
    server: process.env.CARMELTON_DB_SERVER!,
    port: parseInt(process.env.CARMELTON_DB_PORT!, 10),
    database: process.env.CARMELTON_DB_NAME!,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  },

  port: parseInt(process.env.SERVER_PORT || "3002", 10),
};
