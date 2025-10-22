// Main server application entry point - Provides HTTP/WebSocket server and initializes
// all required services including the resilient job scheduler for recovery from interruptions

import path from "path";

// Load environment variables before anything else
import loadEnvironmentVariables from "./config/envLoader";
loadEnvironmentVariables();

import { ConnectionManager } from "./utils/connectionManager";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { config } from "./config/config";
import { writeToLogFile } from "./config/logger";
import PerformanceMonitor from "./utils/performanceMonitor";
import priorityRoutes from "./routers/priorityRoutes";
import jobRoutes from "./routers/jobRouters";
import configRouter from "./routers/configRouters";
import dashboardRouter from "./routers/dashboardRouter";
import authRouter from "./routers/authRouter";
import whereClauseRouter from "./routers/whereClauseRouter";
import jobTypesRouter from "./routers/jobTypesRouter";
import jobSchedulerRouter from "./routers/jobSchedulerRouter";
// Import the job scheduler initialization function
import { initializeJobScheduler } from "./controllers/jobSchedulerController";

// Initialize Express app
const app = express();
const port = config.port;
const httpServer = createServer(app);

// Dynamically build allowed origins from environment variables
const clientPorts = process.env.CLIENT_PORTS?.split(",").map((p) =>
  p.trim()
) || ["3000", "3007"];
const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) =>
  h.trim()
) || ["localhost", "172.34.0.10"];

// Generate all combinations of hosts and ports
const allowedOrigins = allowedHosts.flatMap((host) =>
  // Include server port and all client ports
  [port, ...clientPorts].map((p) => `http://${host}:${p}`)
);

// For debugging purposes
console.log("🔒 CORS allowed origins:", allowedOrigins);
// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
export { io };

const connectionManager = new ConnectionManager(io);

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

// Routers
app.use("/auth", authRouter);
app.use("/priority", priorityRoutes);
app.use("/job", jobRoutes);
app.use("/config", configRouter);
app.use("/dashboard", dashboardRouter);
app.use("/where-clause", whereClauseRouter);
app.use("/api", jobTypesRouter);
app.use("/api/job-scheduler", jobSchedulerRouter);

// Serve React client static files
app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

// Start server
httpServer.listen(port, "0.0.0.0", () => {
  const startupTime = Date.now();
  console.log(`🚀 App is listening at http://0.0.0.0:${port}`);
  console.log(`📡 WebSocket server is running`);
  console.log(`📝 Logs are at ./logs under root folder.`);

  writeToLogFile(
    "general.log",
    `[INFO] Server started in ${Date.now() - startupTime}ms`
  );

  // Initialize job scheduler with recovery capability after server has started
  initializeJobScheduler()
    .then(() => {
      console.log("✅ Job scheduler initialized with recovery capabilities");
      writeToLogFile(
        "general.log",
        `[INFO] Job scheduler initialized with recovery capabilities`
      );
    })
    .catch((error) => {
      console.error("❌ Failed to initialize job scheduler:", error);
      writeToLogFile(
        "error.log",
        `[ERROR] Failed to initialize job scheduler: ${error.message}`
      );
    });

  PerformanceMonitor.logServerMetrics();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("⚠️ Received SIGTERM. Performing graceful shutdown...");
  writeToLogFile("general.log", "[INFO] Server shutting down...");
  PerformanceMonitor.logServerMetrics();

  // Close all socket connections first
  connectionManager.closeAllConnections();

  // Then close the HTTP server
  httpServer.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  writeToLogFile(
    "error.log",
    `FATAL ERROR: Uncaught exception: ${error.message}\n${error.stack}`
  );
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled Promise Rejection:", reason);
  writeToLogFile(
    "error.log",
    `FATAL ERROR: Unhandled promise rejection: ${reason}`
  );
});
