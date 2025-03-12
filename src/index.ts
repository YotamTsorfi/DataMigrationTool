// index.ts

import express from 'express';
import cors from 'cors';
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

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
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
//app.use(cors());
app.use(
  cors({
    origin: "http://localhost:3000", // restrict calls to those this address
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