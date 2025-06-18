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
      AND CreatedBy = 'Yotam'
    `;

      const tableDistributionQuery = `
      SELECT TableName, COUNT(*) as Count
      FROM PriorityJobsHistory
      ${whereClause}
      AND CreatedBy = 'Yotam'
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
  }
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
      AND CreatedBy = 'Yotam'
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
      AND CreatedBy = 'Yotam'
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
  }
);

//-----------------------------------
router.get(
  "/error-groups",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobType = "all", tableName = "all" } = req.query;

      // Find the actual database table name if jobType is provided
      let sourceTableName: string | null = null;

      if (jobType !== "all") {
        const jobTypeQuery = `
          SELECT DBTableName
          FROM PriorityJobTypes
          WHERE JobTypeName = '${jobType}'
        `;

        const jobTypeResult = await DatabaseService.executeQuery(jobTypeQuery);
        if (jobTypeResult.length > 0) {
          sourceTableName = (jobTypeResult[0] as { DBTableName: string })
            .DBTableName;
        }
      } else if (tableName !== "all") {
        // If tableName is directly specified, we'll use it
        sourceTableName = tableName as string;
      }

      // If no valid table name found, return empty results
      if (!sourceTableName) {
        res.status(200).json({
          success: true,
          errorGroups: [],
          totalErrors: 0,
        });
        return;
      }

      // Check if the table exists before querying it
      const tableExistsQuery = `
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = '${sourceTableName}'
      `;

      const tableExists = await DatabaseService.executeQuery(tableExistsQuery);

      if (tableExists.length === 0) {
        res.status(200).json({
          success: true,
          errorGroups: [],
          totalErrors: 0,
          message: `Table ${sourceTableName} does not exist`,
        });
        return;
      }

      // Query to get grouped errors
      const errorGroupsQuery = `
        SELECT 
          CleanError, 
          COUNT(*) as count,
          MIN(Error) as sampleError,
          MIN(reference_id) as sampleReferenceId,
          MIN(StatusCode) as statusCode
        FROM ${sourceTableName}
        WHERE is_eligible = 1 
          AND (Status IS NULL OR Status = 'Failed')
          AND CleanError IS NOT NULL          
        GROUP BY CleanError
        ORDER BY COUNT(*) DESC
      `;

      // Query to get total error count
      const totalErrorsQuery = `
        SELECT COUNT(*) as total
        FROM ${sourceTableName}
        WHERE is_eligible = 1 
          AND (Status IS NULL OR Status = 'Failed')
          AND CleanError IS NOT NULL          
      `;

      const [errorGroups, totalErrorsResult] = await Promise.all([
        DatabaseService.executeQuery(errorGroupsQuery),
        DatabaseService.executeQuery(totalErrorsQuery),
      ]);

      res.status(200).json({
        success: true,
        errorGroups,
        totalErrors: (totalErrorsResult[0] as { total: number }).total,
        tableName: sourceTableName,
      });
    } catch (error) {
      console.error("Error fetching error groups:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
//-----------------------------------
router.get("/db-tables", async (req: Request, res: Response): Promise<void> => {
  try {
    const query = `
      SELECT DISTINCT DBTableName
      FROM PriorityJobTypes
      WHERE DBTableName IS NOT NULL
      ORDER BY DBTableName
    `;

    const tables = await DatabaseService.executeQuery(query);
    const tableNames = tables.map((table: any) => table.DBTableName);

    res.status(200).json(tableNames);
  } catch (error) {
    console.error("Error fetching database tables:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
//-----------------------------------
// API endpoint to get success records statistics for a specific table/job
router.get(
  "/success-records",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobType = "all", tableName = "all" } = req.query;

      // Find the actual database table name if jobType is provided
      let sourceTableName: string | null = null;

      if (jobType !== "all") {
        const jobTypeQuery = `
          SELECT DBTableName
          FROM PriorityJobTypes
          WHERE JobTypeName = '${jobType}'
        `;

        const jobTypeResult = await DatabaseService.executeQuery(jobTypeQuery);
        if (jobTypeResult.length > 0) {
          sourceTableName = (jobTypeResult[0] as { DBTableName: string })
            .DBTableName;
        }
      } else if (tableName !== "all") {
        // If tableName is directly specified, we'll use it
        sourceTableName = tableName as string;
      }

      // If no valid table name found, return empty results
      if (!sourceTableName) {
        res.status(200).json({
          success: true,
          successCount: 0,
          message: "Please select a valid job type or table name",
        });
        return;
      }

      // Check if the table exists before querying it
      const tableExistsQuery = `
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = '${sourceTableName}'
      `;

      const tableExists = await DatabaseService.executeQuery(tableExistsQuery);

      if (tableExists.length === 0) {
        res.status(200).json({
          success: true,
          successCount: 0,
          message: `Table ${sourceTableName} does not exist`,
        });
        return;
      }

      // Query to get successful records count
      const successCountQuery = `
        SELECT COUNT(*) as successCount
        FROM ${sourceTableName}
        WHERE is_eligible = 1 
          AND Status = 'Completed'
      `;

      // Get total records count for comparison
      const totalCountQuery = `
        SELECT COUNT(*) as total
        FROM ${sourceTableName}
        WHERE is_eligible = 1
      `;

      const [successResult, totalResult] = await Promise.all([
        DatabaseService.executeQuery(successCountQuery),
        DatabaseService.executeQuery(totalCountQuery),
      ]);

      const successCount = (successResult[0] as { successCount: number })
        .successCount;
      const totalCount = (totalResult[0] as { total: number }).total;
      const successRate =
        totalCount > 0 ? (successCount / totalCount) * 100 : 0;

      res.status(200).json({
        success: true,
        successCount,
        totalCount,
        successRate: parseFloat(successRate.toFixed(2)),
        tableName: sourceTableName,
      });
    } catch (error) {
      console.error("Error fetching success records count:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
//-----------------------------------
// API endpoint to copy failed records from a source table to PriorityErrorLogs
router.post(
  "/copy-failed-records",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { sourceTableName } = req.body;

      if (!sourceTableName || sourceTableName === "all") {
        res.status(400).json({
          success: false,
          message: "Please select a valid table name",
        });
        return;
      }

      // Log the start of the copy operation
      console.log(
        `Starting copy of failed records from table: ${sourceTableName}`
      );

      // Check if the table exists before proceeding
      const tableExistsQuery = `
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = '${sourceTableName}'
      `;

      const tableExists = await DatabaseService.executeQuery(tableExistsQuery);

      if (tableExists.length === 0) {
        res.status(404).json({
          success: false,
          message: `Table ${sourceTableName} does not exist`,
        });
        // Log the end of the copy operation with failure
        console.log(`Copy failed: Table ${sourceTableName} does not exist`);
        return;
      }

      // Insert failed records from source table into PriorityErrorLogs
      // Only include JobIds that haven't been processed before for this table
      const insertQuery = `
        INSERT INTO PriorityErrorLogs (
          JobName,
          BatchId,
          TableName,
          RowId,
          Error,
          Timestamp,
          JobId,
          ErrorStatus,
          OriginalRowIdentifier,
          CleanError,
          StatusCode,
          CreatedBy
        )
        SELECT
          JobName,
          BatchId,
          '${sourceTableName}' as TableName,
          RowId,
          Error,
          GETDATE() as Timestamp,
          JobId,
          'New' as ErrorStatus,
          reference_id as OriginalRowIdentifier,
          CleanError,
          StatusCode,
          'Yotam' as CreatedBy
        FROM ${sourceTableName} source
        WHERE Status = 'Failed' AND is_eligible = 1
        AND NOT EXISTS (
          -- Avoid all records from JobIds that have already been processed for this table
          SELECT 1 FROM PriorityErrorLogs 
          WHERE PriorityErrorLogs.JobId = source.JobId
          AND PriorityErrorLogs.TableName = '${sourceTableName}'
        )
      `;

      // Execute the insert query and get the number of affected rows
      const rowsAffected = await DatabaseService.executeNonQuery(insertQuery);

      // Log the end of the copy operation with success
      console.log(
        `Finished copying failed records from table: ${sourceTableName}. Copied ${rowsAffected} records.`
      );

      res.status(200).json({
        success: true,
        copiedRecords: rowsAffected,
        message: `Successfully copied ${rowsAffected} failed records from ${sourceTableName} to PriorityErrorLogs (only from JobIds not previously processed)`,
      });
    } catch (error) {
      console.error("Error copying failed records:", error);
      // Log the end of the copy operation with error
      console.log(
        "Copy failed due to error:",
        error instanceof Error ? error.message : error
      );
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);
//------------------------------------

export default router;
