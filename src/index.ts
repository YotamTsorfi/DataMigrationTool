// index.ts

// Import modules needed for path resolution first
import * as fs from "fs";
import path from "path";

// נפיץ פונקציה לטעינת משתני סביבה עם לוגים מורחבים
function loadEnvironmentVariables() {
  const isProduction = process.env.NODE_ENV === "production";
  console.log(`Running in ${isProduction ? "PRODUCTION" : "DEVELOPMENT"} mode`);

  // נתיבים אפשריים לקובץ .env
  const envPaths = {
    production: [
      path.resolve(__dirname, "../.env.production"),
      path.resolve(process.cwd(), ".env.production"),
    ],
    development: [
      path.resolve(__dirname, "../.env.development"),
      path.resolve(process.cwd(), ".env.development"),
    ],
  };

  const pathsToTry = isProduction ? envPaths.production : envPaths.development;

  let loaded = false;
  for (const envPath of pathsToTry) {
    if (fs.existsSync(envPath)) {
      console.log(`Loading env variables from: ${envPath}`);
      require("dotenv").config({ path: envPath });
      loaded = true;
      break;
    } else {
      console.log(`Env file not found at: ${envPath}`);
    }
  }

  if (!loaded) {
    console.warn(
      "No .env file was loaded! Environment variables may be missing."
    );
  }

  // לוג ערך משתנה סביבה קריטי (ללא חשיפת סיסמאות)
  // console.log(
  //   `SERVER_PORT from env: ${process.env.SERVER_PORT || "NOT DEFINED"}`
  // );
}

// טען משתני סביבה לפני כל import אחר שמשתמש בהם
loadEnvironmentVariables();

import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { config } from "./config/config";
import { writeToLogFile } from "./config/logger";
import PerformanceMonitor from "./utils/performanceMonitor";
import priorityRoutes from "./routers/priorityRoutes";
import userRouter from "./routers/userRouter";
import jobRoutes from "./routers/jobRouters";
import configRouter from "./routers/configRouters";
import dashboardRouter from "./routers/dashboardRouter";

// -----------------------------------------------------------------

// Initialize Express app
const app = express();
const port = config.port;
const httpServer = createServer(app);

const allowedOrigins = [
  `http://localhost:${port}`,
  "http://localhost:3000",
  "http://localhost:3005",
];

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Export io to be used in other files
export { io };

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Middleware
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Routers
app.use("/priority", priorityRoutes);
app.use("/api", userRouter);
app.use("/job", jobRoutes);
app.use("/config", configRouter);
app.use("/dashboard", dashboardRouter);

// הגשת קבצי ה-client כ-static
app.use(express.static(path.join(__dirname, "../client/build")));

// כל בקשה שלא נמצאה - תחזיר את index.html של ה-client
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

// Start server
httpServer.listen(port, "0.0.0.0", () => {
  const startupTime = Date.now();
  console.log(`App is listening at http://0.0.0.0:${port}`);
  console.log(`WebSocket server is running`);
  console.log(`Logs are at ./logs under root folder.`);
  writeToLogFile(
    "general.log",
    `[INFO] Server started in ${Date.now() - startupTime}ms`
  );

  // Write server metrics to log file
  PerformanceMonitor.logServerMetrics();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM. Performing graceful shutdown...");
  writeToLogFile("general.log", "[INFO] Server shutting down...");

  // Write server metrics to log file
  PerformanceMonitor.logServerMetrics();

  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  writeToLogFile(
    "error.log",
    `FATAL ERROR: Uncaught exception: ${error.message}\n${error.stack}`
  );
  // Optionally implement notification mechanism for critical errors
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Promise Rejection:", reason);
  writeToLogFile(
    "error.log",
    `FATAL ERROR: Unhandled promise rejection: ${reason}`
  );
});
