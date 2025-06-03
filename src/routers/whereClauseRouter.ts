/**
 * Router for handling WHERE clause related API endpoints
 * Provides routes for validating, retrieving, and updating custom WHERE clauses
 */
import express, { Router } from "express";
import { whereClauseController } from "../controllers/whereClauseController";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";

const router: Router = express.Router();

// Apply authentication middleware
router.use(priorityAuthMiddleware);

// Validate a WHERE clause
router.post("/validate", whereClauseController.validateWhereClause);

// Get WHERE clause for a specific job type
router.get("/:jobType", whereClauseController.getWhereClause);

// Set WHERE clause for a specific job type
router.put("/:jobType", whereClauseController.setWhereClause);

export default router;
