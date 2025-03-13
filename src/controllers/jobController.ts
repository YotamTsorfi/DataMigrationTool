import { Request, Response } from "express";
import { poolPromise } from "../config/db";
import { JobManager } from "../jobs/jobManager"; // Import JobManager

interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
  jobType: string;
}

export const runJobWithInput = async (req: Request, res: Response) => {
  const {
    recordCount,
    startRow,
    tableName,
    priorityScreenName,
    jobType,
  }: JobRequest = req.body;

  try {
    const jobManager = new JobManager();
    const jobId = await jobManager.createJob({
      recordCount,
      startRow,
      tableName,
      priorityScreenName,
      jobType,
    });

    const results = await jobManager.startJob(jobId, {
      recordCount,
      startRow,
      tableName,
      priorityScreenName,
      jobType,
    });

    res.status(200).json(results);
  } catch (error) {
    console.error("Error running job:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// -----------------------------------------------------------------
export const getJobTypes = async (req: Request, res: Response) => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const result = await pool.request().query(`
      SELECT JobTypeId, JobTypeName, DBTableName, ScreenName FROM PriorityJobTypes
    `);
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("Error fetching job types:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
