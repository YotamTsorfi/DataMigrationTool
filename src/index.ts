import * as fs from "fs";
import path from "path";

// Load environment variables before anything else
import loadEnvironmentVariables from "./config/envLoader";
loadEnvironmentVariables();

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
import authRouter from "./routers/authRouter";
import whereClauseRouter from "./routers/whereClauseRouter";
import jobTypesRouter from "./routers/jobTypesRouter";

// Initialize Express app
const app = express();
const port = config.port;
const httpServer = createServer(app);

const allowedOrigins = [
  `http://localhost:${port}`,
  "http://localhost:3000",
  "http://localhost:3005",
  "http://carmelton.dev",
  "https://carmelton.dev",
  "http://172.34.0.10",
  "http://172.34.0.10:80",
  "http://172.34.0.10:3000",
  "https://172.34.0.10:3000",
];

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
export { io };

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
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

// Add auth middleware globally for optional user identification
// app.use(authMiddleware.optionalToken);

// Routers
app.use("/auth", authRouter);
app.use("/priority", priorityRoutes);
app.use("/api", userRouter);
app.use("/job", jobRoutes);
app.use("/config", configRouter);
app.use("/dashboard", dashboardRouter);
app.use("/where-clause", whereClauseRouter);
app.use("/api", jobTypesRouter);

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
  PerformanceMonitor.logServerMetrics();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("⚠️ Received SIGTERM. Performing graceful shutdown...");
  writeToLogFile("general.log", "[INFO] Server shutting down...");
  PerformanceMonitor.logServerMetrics();
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
