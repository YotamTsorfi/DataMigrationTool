/**
 * Authentication middleware for protecting routes.
 * Validates JWT tokens and attaches user information to requests.
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Secret should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET || "carmelton-migration-secret-key";

// Extend Express Request to include user information
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
        isAdmin: boolean;
      };
    }
  }
}

export const authMiddleware = {
  /**
   * Verifies that the request contains a valid JWT token
   */
  verifyToken(req: Request, res: Response, next: NextFunction): void {
    // Get token from header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // Format: "Bearer TOKEN"

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
      return;
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded as {
        userId: string;
        username: string;
        isAdmin: boolean;
      };
      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        message: "Invalid token.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },

  /**
   * Optional token verification - attaches user if token is valid,
   * but continues even if no token or invalid token
   */
  optionalToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      next();
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded as {
        userId: string;
        username: string;
        isAdmin: boolean;
      };
    } catch (error) {
      // Continue without setting req.user
      console.warn("Invalid token provided:", error);
    }

    next();
  },

  /**
   * Ensures the requesting user has admin privileges
   */
  requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    if (!req.user.isAdmin) {
      res.status(403).json({
        success: false,
        message: "Admin privileges required",
      });
      return;
    }

    next();
  },
};
