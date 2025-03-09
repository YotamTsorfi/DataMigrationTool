import express from "express";
import { poolPromise } from "../config/db";
import { configService } from "../config/configService";

// Create router object with explicit type
const router: express.Router = express.Router();

// Use function declarations instead of arrow functions
router.get("/", function(req, res) {
  (async function() {
    try {
      const pool = await poolPromise;
      if (!pool) {
        throw new Error("Database connection failed");
      }

      const result = await pool.request().query(`
        SELECT ConfigKey, ConfigValue, Description, LastUpdated 
        FROM PrioritySystemConfig
        ORDER BY ConfigKey
      `);

      res.status(200).json(result.recordset);
    } catch (error) {
      console.error("Error fetching configuration:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

router.put("/:key", function(req, res) {
  (async function() {
    const key = req.params.key;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: "Value is required" });
    }

    try {
      const success = await configService.updateConfig(key, value);
      if (success) {
        res.status(200).json({ message: `${key} updated successfully` });
      } else {
        res.status(500).json({ error: "Failed to update configuration" });
      }
    } catch (error) {
      console.error(`Error updating configuration ${key}:`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
});

export default router;