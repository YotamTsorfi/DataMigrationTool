/**
 * Controller for handling WHERE clause validation and management
 * Provides functionality to validate, retrieve, and update custom WHERE clauses for job types
 */
import { Request, Response } from "express";
import { configService } from "../config/configService";

export const whereClauseController = {
  /**
   * Validates a WHERE clause for syntax and security issues
   */
  async validateWhereClause(req: Request, res: Response): Promise<void> {
    try {
      const { whereClause } = req.body;

      if (!whereClause) {
        res.status(200).json({ valid: true, message: "Empty clause is valid" });
        return;
      }

      // Access the private method via the configService instance
      // This is a bit of a hack but avoids duplicating validation logic
      const isValid = (configService as any)["isValidWhereClause"](whereClause);

      if (isValid) {
        res.status(200).json({ valid: true });
      } else {
        res.status(400).json({
          valid: false,
          message:
            "Invalid WHERE clause. Contains prohibited SQL or syntax errors.",
        });
      }
    } catch (error) {
      console.error("Error validating WHERE clause:", error);
      res.status(500).json({
        valid: false,
        message: "Server error occurred during validation",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },

  /**
   * Gets the custom WHERE clause for a specific job type
   */
  async getWhereClause(req: Request, res: Response): Promise<void> {
    try {
      const { jobType } = req.params;

      if (!jobType) {
        res.status(400).json({ error: "Job type is required" });
        return;
      }

      const whereClause = await configService.getWhereClauseForJobType(jobType);

      res.status(200).json({
        jobType,
        whereClause,
        baseWhereClause: configService.getBaseWhereClause(),
      });
    } catch (error) {
      console.error(
        `Error getting WHERE clause for job type ${req.params.jobType}:`,
        error
      );
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },

  /**
   * Sets a custom WHERE clause for a specific job type
   */
  async setWhereClause(req: Request, res: Response): Promise<void> {
    try {
      const { jobType } = req.params;
      const { whereClause } = req.body;

      if (!jobType) {
        res.status(400).json({ error: "Job type is required" });
        return;
      }

      // Empty string is allowed (clears the custom WHERE clause)
      const clauseToSet = whereClause || "";

      const success = await configService.setWhereClauseForJobType(
        jobType,
        clauseToSet
      );

      if (success) {
        res.status(200).json({
          message: `WHERE clause for ${jobType} updated successfully`,
          whereClause: clauseToSet,
        });
      } else {
        res
          .status(400)
          .json({
            error:
              "Failed to update WHERE clause. It may contain invalid syntax.",
          });
      }
    } catch (error) {
      console.error(
        `Error setting WHERE clause for job type ${req.params.jobType}:`,
        error
      );
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
};
