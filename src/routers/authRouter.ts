/**
 * Authentication routes for user login, logout, and token verification.
 */
import express from "express";
import { authController } from "../controllers/authController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = express.Router();

// Public routes
router.post("/login", authController.login);
router.post("/logout", authController.logout);

// Protected routes
router.get("/verify", authMiddleware.verifyToken, authController.verifyToken);

export default router;
