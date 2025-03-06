import express from "express";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";
import { poolPromise } from "../config/db";
import { runJobWithInput, getJobTypes } from "../controllers/jobController";

const router = express.Router();

router.use(priorityAuthMiddleware);
//-------------------------------------------------

router.post("/run-job", runJobWithInput);

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

router.get("/job-types", getJobTypes);

export default router;
