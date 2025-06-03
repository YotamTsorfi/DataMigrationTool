/**
 * Authentication controller handling login, logout, and session verification.
 * Implements JWT token-based authentication.
 */
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserService } from "../models/User";

// Secret should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET || "carmelton-migration-secret-key";
const TOKEN_EXPIRY = "24h";

export const authController = {
  /**
   * Authenticates a user and issues a JWT token
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;

      // Check for missing credentials
      if (!username || !password) {
        console.log("Missing credentials", {
          username: !!username,
          password: !!password,
        });
        res.status(400).json({
          success: false,
          message: "Username and password are required",
        });
        return;
      }

      // Validate the user
      const user = await UserService.validateUser(username, password);

      if (!user) {
        console.log("Authentication failed: Invalid credentials");
        res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
        return;
      }

      // Update last login timestamp
      UserService.updateLastLogin(username);

      // Create token with user information
      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          isAdmin: user.isAdmin,
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
      );

      // Send success response with token
      res.status(200).json({
        success: true,
        message: "Authentication successful",
        token,
        user: {
          id: user.id,
          username: user.username,
          isAdmin: user.isAdmin,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred during authentication",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },

  /**
   * Verifies a user's token is valid
   */
  verifyToken(req: Request, res: Response): void {
    res.status(200).json({
      success: true,
      user: req.user,
    });
  },

  /**
   * Dummy logout endpoint - actual logout happens on client
   */
  logout(req: Request, res: Response): void {
    res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  },
};
