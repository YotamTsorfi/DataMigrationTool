// index.ts

import express from 'express';
import cors from 'cors';
import { config } from './config/config';
import { writeToLogFile } from "./config/logger";
import PerformanceMonitor from "./utils/performanceMonitor";

import priorityRoutes from "./routers/priorityRoutes";
import userRouter from "./routers/userRouter";
import batchRoutes from "./routers/batchRoutes";

import { connectToCarmeltonDatabase } from "./database/connection";

// Initialize Express app
const app = express();

// Connect to DB
connectToCarmeltonDatabase();

const port = config.port;
const http = require("http").createServer(app);

// Middleware
//app.use(cors());
app.use(
  cors({
    origin: "http://localhost:3000", // או הדומיין שבו ירוץ הקליינט
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Routers
app.use("/priority", priorityRoutes);
app.use("/api", userRouter);
app.use("/api/batch", batchRoutes);

// Start server
http.listen(port, "0.0.0.0", () => {
  const startupTime = Date.now();
  console.log(`App is listening at http://0.0.0.0:${port}`);
  console.log(`Logs are at ./logs under root folder.`);

  // רישום זמן עליית השרת
  writeToLogFile(
    "general.log",
    `[INFO] Server started in ${Date.now() - startupTime}ms`
  );

  // רישום מדדי ביצועים ראשוניים של השרת
  PerformanceMonitor.logServerMetrics();

  // הרצת הטסט לאחר השהייה קצרה
  // setTimeout(async () => {
  //     try {
  //         await testBatchVehicles();
  //     } catch (error) {
  //         const errorMessage = error instanceof Error
  //             ? error.message
  //             : 'An unknown error occurred';

  //         console.error('Failed to run batch test:', errorMessage);
  //         writeToLogFile('general.log', `[ERROR] Failed to run batch test: ${errorMessage}`);
  //     }
  // }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Performing graceful shutdown...');
    writeToLogFile('general.log', '[INFO] Server shutting down...');
    
    // רישום מדדי ביצועים אחרונים
    PerformanceMonitor.logServerMetrics();
    
    http.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});