/**
 * Configuration management router that handles CRUD operations
 * for the PrioritySystemConfig table. Allows fetching, updating,
 * creating and deleting system configuration values.
 */
import express from "express";
import { configService } from "../config/configService";
import { DatabaseService } from "../services/databaseService";

// Define interface for query results with rowsAffected property
interface QueryResult {
  recordset?: any[];
  rowsAffected?: number[];
  output?: Record<string, any>;
  [key: string]: any;
}

// Create router object with explicit type
const router: express.Router = express.Router();

// Get all visible configurations
router.get("/", function (req, res) {
  (async function () {
    try {
      const configs = await DatabaseService.executeQuery(`
          SELECT * FROM PrioritySystemConfig 
          WHERE IsVisible = 1          
      `);

      res.status(200).json(configs);
    } catch (error) {
      console.error("Error fetching configuration:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

// Get a specific configuration
router.get("/:key", function (req, res) {
  (async function () {
    const key = req.params.key;

    try {
      const config = await DatabaseService.executeQuery(
        `
          SELECT * FROM PrioritySystemConfig 
          WHERE ConfigKey = @key
      `,
        { key }
      );

      if (config && config.length > 0) {
        res.status(200).json(config[0]);
      } else {
        res.status(404).json({ error: `Configuration '${key}' not found` });
      }
    } catch (error) {
      console.error(`Error fetching configuration ${key}:`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

// Create a new configuration
router.post("/", function (req, res) {
  (async function () {
    const { key, value, description, isVisible = true } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({
        error: "Key and value are required",
      });
    }

    try {
      // Check if key already exists
      const existing = await DatabaseService.executeQuery(
        `
          SELECT * FROM PrioritySystemConfig 
          WHERE ConfigKey = @key
      `,
        { key }
      );

      if (existing && existing.length > 0) {
        return res.status(409).json({
          error: `Configuration key '${key}' already exists`,
        });
      }

      // Insert new configuration
      await DatabaseService.executeQuery(
        `
          INSERT INTO PrioritySystemConfig (ConfigKey, ConfigValue, Description, LastUpdated, IsVisible)
          VALUES (@key, @value, @description, GETDATE(), @isVisible)
      `,
        { key, value, description, isVisible }
      );

      // Refresh the config service cache
      await configService.loadConfigFromDb();

      res.status(201).json({
        message: `Configuration '${key}' created successfully`,
      });
    } catch (error) {
      console.error(`Error creating configuration ${key}:`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

// Update an existing configuration
router.put("/:key", function (req, res) {
  (async function () {
    const key = req.params.key;
    const { value, description, isVisible } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: "Value is required" });
    }

    try {
      // First check if the key exists
      const existingConfig = await DatabaseService.executeQuery(
        `
        SELECT ConfigId FROM PrioritySystemConfig 
        WHERE ConfigKey = @key
        `,
        { key }
      );

      if (!existingConfig || existingConfig.length === 0) {
        return res
          .status(404)
          .json({ error: `Configuration '${key}' not found` });
      }

      // Build the update query dynamically based on provided fields
      let updateQuery = `
        UPDATE PrioritySystemConfig 
        SET ConfigValue = @value, LastUpdated = GETDATE()`;

      if (description !== undefined) {
        updateQuery += `, Description = @description`;
      }

      if (isVisible !== undefined) {
        updateQuery += `, IsVisible = @isVisible`;
      }

      updateQuery += ` WHERE ConfigKey = @key`;

      await DatabaseService.executeQuery(updateQuery, {
        key,
        value,
        description,
        isVisible,
      });

      // Refresh the config service cache
      await configService.loadConfigFromDb();
      res.status(200).json({ message: `${key} updated successfully` });
    } catch (error) {
      console.error(`Error updating configuration ${key}:`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

// Delete a configuration
router.delete("/:key", function (req, res) {
  (async function () {
    const key = req.params.key;

    try {
      const result = (await DatabaseService.executeQuery(
        `
          DELETE FROM PrioritySystemConfig 
          WHERE ConfigKey = @key
      `,
        { key }
      )) as QueryResult; // Type assertion here

      // Check if any row was affected
      if (result && result.rowsAffected && result.rowsAffected[0] > 0) {
        // Refresh the config service cache
        await configService.loadConfigFromDb();
        res
          .status(200)
          .json({ message: `Configuration '${key}' deleted successfully` });
      } else {
        res.status(404).json({ error: `Configuration '${key}' not found` });
      }
    } catch (error) {
      console.error(`Error deleting configuration ${key}:`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

export default router;
