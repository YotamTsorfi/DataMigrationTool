import express, { Request, Response, Router } from "express";
import { priorityAuthMiddleware } from "../middleware/priorityAuth";
import { DatabaseService } from "../services/databaseService";
import moment from "moment-timezone";

const router: Router = express.Router();

router.use(priorityAuthMiddleware);

// New dashboard API endpoints
//-----------------------------------
router.get(
  "/dashboard-summary",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        dateRange = "last7days",
        statusFilter = "all",
        jobFilter = "all",
        tableFilter = "all",
      } = req.query;

      // Calculate date filter based on dateRange
      let dateFilter = "";
      // const now = new Date();

      if (dateRange === "today") {
        const today = moment().startOf("day").format("YYYY-MM-DD");
        dateFilter = `AND CONVERT(DATE, StartTime) = '${today}'`;
      } else if (dateRange === "yesterday") {
        const yesterday = moment()
          .subtract(1, "days")
          .startOf("day")
          .format("YYYY-MM-DD");
        dateFilter = `AND CONVERT(DATE, StartTime) = '${yesterday}'`;
      } else if (dateRange === "last7days") {
        const last7days = moment().subtract(7, "days").format("YYYY-MM-DD");
        dateFilter = `AND StartTime >= '${last7days}'`;
      } else if (dateRange === "last30days") {
        const last30days = moment().subtract(30, "days").format("YYYY-MM-DD");
        dateFilter = `AND StartTime >= '${last30days}'`;
      }

      // Build where clause for filters
      let whereClause = dateFilter ? `WHERE 1=1 ${dateFilter}` : "WHERE 1=1";

      if (statusFilter !== "all") {
        whereClause += ` AND Status = '${statusFilter}'`;
      }

      if (jobFilter !== "all") {
        whereClause += ` AND JobName = '${jobFilter}'`;
      }

      if (tableFilter !== "all") {
        whereClause += ` AND TableName = '${tableFilter}'`;
      }

      // Execute aggregate queries with optimized performance
      const summaryQuery = `
      SELECT 
        COUNT(DISTINCT JobId) AS totalJobs,
        SUM(CASE WHEN Status = 'Completed' THEN 1 ELSE 0 END) AS completedJobs,
        SUM(CASE WHEN Status = 'Failed' THEN 1 ELSE 0 END) AS failedJobs,
        SUM(CASE WHEN Status = 'In Progress' OR Status = 'Running' THEN 1 ELSE 0 END) AS inProgressJobs,
        SUM(CASE WHEN Status = 'Queued' THEN 1 ELSE 0 END) AS queuedJobs,
        SUM(CASE WHEN Status = 'CompletedButNotSynced' THEN 1 ELSE 0 END) AS notSyncedJobs,
        SUM(TotalRecords) AS totalRecords,
        SUM(SuccessCount) AS successRecords,
        SUM(FailureCount) AS failureRecords,
        CAST(100.0 * SUM(SuccessCount) / NULLIF(SUM(TotalRecords), 0) AS DECIMAL(5,2)) AS successRate,
        AVG(CASE WHEN Status = 'Completed' AND EndTime IS NOT NULL 
            THEN DATEDIFF(SECOND, StartTime, EndTime) END) AS averageProcessingTime,
        SUM(CASE WHEN CONVERT(DATE, StartTime) = CONVERT(DATE, GETDATE()) THEN 1 ELSE 0 END) AS todayJobs
      FROM PriorityJobsHistory
      ${whereClause}
    `;

      const tableDistributionQuery = `
      SELECT TableName, COUNT(*) as Count
      FROM PriorityJobsHistory
      ${whereClause}
      GROUP BY TableName
      ORDER BY Count DESC
    `;

      const [summaryResults, tableDistribution] = await Promise.all([
        DatabaseService.executeQuery(summaryQuery),
        DatabaseService.executeQuery(tableDistributionQuery),
      ]);

      // Convert table distribution to object format for easier frontend consumption
      const tableCounts: Record<string, number> = {};
      (tableDistribution as any[]).forEach((item) => {
        tableCounts[item.TableName] = item.Count;
      });

      res.status(200).json({
        ...(summaryResults[0] as Record<string, any>),
        tableCounts,
      });
    } catch (error) {
      console.error("Error fetching dashboard summary:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

//-----------------------------------
router.get("/results", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      pageSize = 20,
      dateRange = "last7days",
      status = "all",
      jobType = "all",
      tableName = "all",
    } = req.query;

    const pageNumber = Number(page);
    const limit = Number(pageSize);
    const offset = (pageNumber - 1) * limit;

    // Calculate date filter based on dateRange
    let dateFilter = "";

    if (dateRange === "today") {
      const today = moment().startOf("day").format("YYYY-MM-DD");
      dateFilter = `AND CONVERT(DATE, StartTime) = '${today}'`;
    } else if (dateRange === "yesterday") {
      const yesterday = moment()
        .subtract(1, "days")
        .startOf("day")
        .format("YYYY-MM-DD");
      dateFilter = `AND CONVERT(DATE, StartTime) = '${yesterday}'`;
    } else if (dateRange === "last7days") {
      const last7days = moment().subtract(7, "days").format("YYYY-MM-DD");
      dateFilter = `AND StartTime >= '${last7days}'`;
    } else if (dateRange === "last30days") {
      const last30days = moment().subtract(30, "days").format("YYYY-MM-DD");
      dateFilter = `AND StartTime >= '${last30days}'`;
    }

    // Build where clause for filters
    let whereClause = dateFilter ? `WHERE 1=1 ${dateFilter}` : "WHERE 1=1";

    if (status !== "all") {
      whereClause += ` AND Status = '${status}'`;
    }

    if (jobType !== "all") {
      whereClause += ` AND JobName = '${jobType}'`;
    }

    if (tableName !== "all") {
      whereClause += ` AND TableName = '${tableName}'`;
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM PriorityBatchProcessing
      ${whereClause}
    `;

    // Get actual results with pagination
    const resultsQuery = `
      SELECT *
      FROM PriorityBatchProcessing
      ${whereClause}
      ORDER BY StartTime DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const [countResult, batchResults] = await Promise.all([
      DatabaseService.executeQuery(countQuery),
      DatabaseService.executeQuery(resultsQuery),
    ]);

    res.status(200).json({
      success: true,
      total: (countResult[0] as { total: number }).total,
      batchResults,
    });
  } catch (error) {
    console.error("Error fetching batch results:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

//-----------------------------------
router.get("/errors", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      pageSize = 20,
      dateRange = "last7days",
      jobType = "all",
      tableName = "all",
    } = req.query;

    const pageNumber = Number(page);
    const limit = Number(pageSize);
    const offset = (pageNumber - 1) * limit;

    // Calculate date filter based on dateRange
    let dateFilter = "";

    if (dateRange === "today") {
      const today = moment().startOf("day").format("YYYY-MM-DD");
      dateFilter = `AND CONVERT(DATE, Timestamp) = '${today}'`;
    } else if (dateRange === "yesterday") {
      const yesterday = moment()
        .subtract(1, "days")
        .startOf("day")
        .format("YYYY-MM-DD");
      dateFilter = `AND CONVERT(DATE, Timestamp) = '${yesterday}'`;
    } else if (dateRange === "last7days") {
      const last7days = moment().subtract(7, "days").format("YYYY-MM-DD");
      dateFilter = `AND Timestamp >= '${last7days}'`;
    } else if (dateRange === "last30days") {
      const last30days = moment().subtract(30, "days").format("YYYY-MM-DD");
      dateFilter = `AND Timestamp >= '${last30days}'`;
    }

    // Build where clause for filters
    let whereClause = dateFilter ? `WHERE 1=1 ${dateFilter}` : "WHERE 1=1";

    if (jobType !== "all") {
      whereClause += ` AND JobName = '${jobType}'`;
    }

    if (tableName !== "all") {
      whereClause += ` AND TableName = '${tableName}'`;
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM PriorityErrorLogs
      ${whereClause}
    `;

    // Get actual results with pagination
    const resultsQuery = `
      SELECT *
      FROM PriorityErrorLogs
      ${whereClause}
      ORDER BY Timestamp DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const [countResult, errorLogs] = await Promise.all([
      DatabaseService.executeQuery(countQuery),
      DatabaseService.executeQuery(resultsQuery),
    ]);

    res.status(200).json({
      success: true,
      total: (countResult[0] as { total: number }).total,
      errorLogs,
    });
  } catch (error) {
    console.error("Error fetching error logs:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

//-----------------------------------
router.get(
  "/jobs-history",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        dateRange = "last7days",
        status = "all",
        jobType = "all",
        tableName = "all",
      } = req.query;

      // Calculate date filter based on dateRange
      let dateFilter = "";

      if (dateRange === "today") {
        const today = moment().startOf("day").format("YYYY-MM-DD");
        dateFilter = `AND CONVERT(DATE, StartTime) = '${today}'`;
      } else if (dateRange === "yesterday") {
        const yesterday = moment()
          .subtract(1, "days")
          .startOf("day")
          .format("YYYY-MM-DD");
        dateFilter = `AND CONVERT(DATE, StartTime) = '${yesterday}'`;
      } else if (dateRange === "last7days") {
        const last7days = moment().subtract(7, "days").format("YYYY-MM-DD");
        dateFilter = `AND StartTime >= '${last7days}'`;
      } else if (dateRange === "last30days") {
        const last30days = moment().subtract(30, "days").format("YYYY-MM-DD");
        dateFilter = `AND StartTime >= '${last30days}'`;
      }

      // Build where clause for filters
      let whereClause = dateFilter ? `WHERE 1=1 ${dateFilter}` : "WHERE 1=1";

      if (status !== "all") {
        whereClause += ` AND Status = '${status}'`;
      }

      if (jobType !== "all") {
        whereClause += ` AND JobName = '${jobType}'`;
      }

      if (tableName !== "all") {
        whereClause += ` AND TableName = '${tableName}'`;
      }

      const query = `
      SELECT *
      FROM PriorityJobsHistory
      ${whereClause}
      ORDER BY StartTime DESC
    `;

      const jobsHistory = await DatabaseService.executeQuery(query);

      res.status(200).json({
        success: true,
        jobsHistory,
      });
    } catch (error) {
      console.error("Error fetching jobs history:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

export default router;
