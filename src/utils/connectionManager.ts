import { Server, Socket } from "socket.io";
import { writeToLogFile } from "../config/logger";

/**
 * Class for managing Socket.IO connections
 * Handles connection tracking, cleanup, and error handling
 */
export class ConnectionManager {
  private io: Server;
  private connections: Map<string, Socket> = new Map();
  private inactivityTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor(io: Server) {
    this.io = io;
    this.setupConnectionHandling();
    this.startPeriodicCleanup();
  }

  /**
   * Set up connection event handlers
   */
  private setupConnectionHandling(): void {
    this.io.on("connection", (socket: Socket) => {
      // Store the connection
      this.connections.set(socket.id, socket);

      const clientInfo = {
        id: socket.id,
        ip: socket.handshake.address,
        origin: socket.handshake.headers.origin || "Unknown",
        userAgent: socket.handshake.headers["user-agent"],
      };

      console.log("🟢 Client connected:", {
        id: clientInfo.id,
        ip: clientInfo.ip,
        origin: clientInfo.origin,
      });

      writeToLogFile(
        "general.log",
        `[INFO] Client connected: ${JSON.stringify(clientInfo)}`
      );

      // Set up inactivity timer
      this.resetInactivityTimer(socket.id);

      // Monitor events to reset inactivity timer
      const resetTimer = () => this.resetInactivityTimer(socket.id);
      socket.onAny(resetTimer);

      // Set up disconnect handler
      socket.on("disconnect", (reason) => {
        console.log("🔴 Client disconnected:", socket.id);
        writeToLogFile(
          "general.log",
          `[INFO] Client disconnected: ${socket.id}, reason: ${reason}`
        );
        this.clearInactivityTimer(socket.id);
        this.connections.delete(socket.id);
      });

      // Handle errors
      socket.on("error", (error) => {
        writeToLogFile(
          "error.log",
          `[ERROR] Socket error for ${socket.id}: ${error}`
        );
        this.forceDisconnect(socket.id);
      });
    });
  }

  /**
   * Reset the inactivity timer for a socket
   */
  private resetInactivityTimer(socketId: string): void {
    // Clear existing timer if any
    this.clearInactivityTimer(socketId);

    // Set new timer
    const timer = setTimeout(() => {
      writeToLogFile(
        "general.log",
        `[INFO] Client ${socketId} timed out due to inactivity`
      );
      this.forceDisconnect(socketId);
    }, this.INACTIVE_TIMEOUT);

    // Prevent the timer from keeping Node process alive
    timer.unref();

    // Store the timer
    this.inactivityTimers.set(socketId, timer);
  }

  /**
   * Clear inactivity timer for a socket
   */
  private clearInactivityTimer(socketId: string): void {
    const timer = this.inactivityTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.inactivityTimers.delete(socketId);
    }
  }

  /**
   * Periodically clean up stale connections
   */
  private startPeriodicCleanup(): void {
    // Run cleanup every 15 minutes
    setInterval(
      () => {
        writeToLogFile(
          "general.log",
          `[INFO] Running socket connection cleanup, active connections: ${this.connections.size}`
        );

        // Force close any problematic connections
        this.connections.forEach((socket, id) => {
          if (socket.disconnected) {
            this.connections.delete(id);
            this.clearInactivityTimer(id);
            writeToLogFile(
              "general.log",
              `[INFO] Cleaned up disconnected socket: ${id}`
            );
          }
        });
      },
      15 * 60 * 1000
    );
  }

  /**
   * Force disconnect a specific socket
   */
  public forceDisconnect(socketId: string): void {
    const socket = this.connections.get(socketId);
    if (socket) {
      try {
        socket.disconnect(true);
      } catch (err) {
        writeToLogFile("error.log", `[ERROR] Error forcing disconnect: ${err}`);
      } finally {
        this.clearInactivityTimer(socketId);
        this.connections.delete(socketId);
      }
    }
  }

  /**
   * Get the count of active connections
   */
  public getActiveConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all connections - use during server shutdown
   */
  public closeAllConnections(): void {
    writeToLogFile(
      "general.log",
      `[INFO] Closing all connections (${this.connections.size} active)`
    );

    this.connections.forEach((socket) => {
      try {
        socket.disconnect(true);
      } catch (err) {
        // Just log and continue with other connections
        writeToLogFile(
          "error.log",
          `[ERROR] Error during shutdown disconnect: ${err}`
        );
      }
    });

    // Clear all inactivity timers
    this.inactivityTimers.forEach((timer) => clearTimeout(timer));
    this.inactivityTimers.clear();
    this.connections.clear();
  }
}
