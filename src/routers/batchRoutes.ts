import express from "express";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";
import { runJobWithInput } from "../jobs/runJob";
import { poolPromise } from "../config/db";

const router = express.Router();

router.use(priorityAuthMiddleware);

//-------------------------------------------------
router.post("/run-job", async (req, res) => {
  const { recordCount, startRow } = req.body;
  try {
    await runJobWithInput(recordCount, startRow);
    res
      .status(200)
      .json({ success: true, message: "Job executed successfully" });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/results", async (req, res) => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const batchResults = await pool.request().query(`
            SELECT * FROM PriorityBatchProcessing ORDER BY StartTime
        `);
    const failedVehicles = await pool.request().query(`
            SELECT * FROM AllvehiclesTest WHERE Status = 'Failed'
        `);
    res.status(200).json({
      success: true,
      batchResults: batchResults.recordset,
      failedVehicles: failedVehicles.recordset,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
