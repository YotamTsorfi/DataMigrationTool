import { Request, Response } from "express";
import { poolPromise } from "../config/db";
import { JobManager } from "../jobs/manager/jobManager"; // Import JobManager
import { JobRequest } from "../types/jobTypes";

export const runJobWithInput = async (req: Request, res: Response) => {
  const {
    recordCount,
    startRow,
    tableName,
    priorityScreenName,
    jobType,
    priorityIdField,
  }: JobRequest = req.body;

  try {
    const jobManager = new JobManager();
    const jobId = await jobManager.createJob({
      recordCount,
      startRow,
      tableName,
      priorityScreenName,
      jobType,
      priorityIdField,
    });

    const results = await jobManager.startJob(jobId, {
      recordCount,
      startRow,
      tableName,
      priorityScreenName,
      jobType,
      priorityIdField,
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
      SELECT JobTypeId, JobTypeName, DBTableName, ScreenName, priority_id, linkedField, HebrewName FROM PriorityJobTypes
    `);
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("Error fetching job types:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// -----------------------------------------------------------------
/**
 * Retrieves all active case IDs from the sample_case_id_stg table.
 * Uses the database connection pool for querying.
 * @param req - Express request object
 * @param res - Express response object
 */
export const getActiveCaseIds = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }
    const result = await pool.request().query(`
      SELECT case_id 
      FROM sample_case_id_stg
      WHERE state = 'Active'
      ORDER BY case_id
    `);

    res.status(200).json({
      success: true,
      data: result.recordset.map((row: any) => row.case_id),
    });
  } catch (error) {
    console.error("Error fetching active case IDs:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fetch case IDs",
    });
  }
};

/**
 * Gets the count of records to be added and updated for a delta job
 * @param req - Express request object with tableName and caseId query parameters
 * @param res - Express response object
 */
export const getDeltaRecordCounts = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { tableName, caseId } = req.query;

    if (!tableName || !caseId) {
      res.status(400).json({
        success: false,
        error: "Table name and case ID are required",
      });
      return;
    }

    const pool = await poolPromise;
    if (!pool) {
      throw new Error("Database connection pool is null");
    }

    // Get counts for delta_action=1 (add) and delta_action=2 (update)
    const result = await pool.request().query(`
      SELECT 
        delta_action,
        COUNT(*) as count
      FROM ${tableName}
      WHERE case_id = '${caseId}'
        AND is_eligible = 1
        AND delta_action IN (1, 2)
      GROUP BY delta_action
    `);

    // Process results into a more usable format
    const counts = {
      toAdd: 0,
      toUpdate: 0,
    };

    result.recordset.forEach((row: any) => {
      if (row.delta_action === 1) {
        counts.toAdd = row.count;
      } else if (row.delta_action === 2) {
        counts.toUpdate = row.count;
      }
    });

    res.status(200).json({
      success: true,
      data: counts,
    });
  } catch (error) {
    console.error("Error getting delta record counts:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get record counts",
    });
  }
};
