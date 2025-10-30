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

  // Notify PM2 that the app is ready when wait_ready is true
  if (typeof process.send === "function") {
    try {
      process.send("ready");
    } catch (e) {
      // ignore if not running under PM2
    }
  }
});

// Handle server errors (e.g., EADDRINUSE) to log clearly and exit
httpServer.on("error", (err: any) => {
  const code = (err && err.code) || "";
  if (code === "EADDRINUSE") {
    const msg = `FATAL: Port ${port} already in use (EADDRINUSE).`;
    console.error(msg);
    writeToLogFile("error.log", `[ERROR] ${msg}`);
    // Exit so PM2 can attempt a clean restart instead of overlapping
    process.exit(1);
  } else {
    writeToLogFile(
      "error.log",
      `[ERROR] HTTP server error: ${err?.message || err}`
    );
  }
});

// Centralized graceful shutdown
function handleGracefulShutdown(reason: string): void {
  console.log(`⚠️ Received ${reason}. Performing graceful shutdown...`);
  writeToLogFile(
    "general.log",
    `[INFO] Server shutting down due to ${reason}...`
  );
  try {
    PerformanceMonitor.logServerMetrics();
  } catch (e) {
    // Ignore metrics logging errors during shutdown
    writeToLogFile(
      "error.log",
      `[WARN] Failed to log server metrics on shutdown: ${e}`
    );
  }

  // Close all socket connections first
  try {
    connectionManager.closeAllConnections();
  } catch (e) {
    // Ignore connection close errors during shutdown
    writeToLogFile(
      "error.log",
      `[WARN] Failed to close all connections on shutdown: ${e}`
    );
  }

  // Then stop accepting new connections and close existing ones
  httpServer.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });

  // Safety exit after timeout to avoid hanging forever
  setTimeout(() => {
    console.error("💥 Force exiting after shutdown timeout");
    process.exit(1);
  }, 30000).unref();
}

// Graceful shutdown hooks (PM2/OS)
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("message", (msg: any) => {
  if (msg === "shutdown") {
    handleGracefulShutdown("PM2 shutdown");
  }
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
