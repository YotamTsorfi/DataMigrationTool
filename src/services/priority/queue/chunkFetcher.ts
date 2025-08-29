import { DatabaseService } from "../../database/databaseService";
import { ChildJob } from "../../../types/jobTypes";
import PerformanceMonitor from "../../../utils/performanceMonitor";

/**
 * Fetches parent records with their related child records in chunks
 * Compared to stream implementation, this loads all data at once per chunk
 */
export async function fetchParentChildChunk(
  parentTableName: string,
  batchSize: number,
  startRow: number,
  maxRows: number,
  linkedField: string,
  childJobs: ChildJob[],
  perfMonitor?: PerformanceMonitor,
  customWhereClause?: string,
  caseId?: string
): Promise<any[]> {
  const startMonitoring = !perfMonitor;
  if (startMonitoring) {
    perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();
  }

  // Limit chunk size to prevent memory issues
  const chunkSize = Math.min(batchSize, maxRows);

  try {
    // Fetch parent records
    const parentRecords = await fetchEligibleParentRecords(
      parentTableName,
      startRow,
      chunkSize,
      linkedField,
      customWhereClause,
      caseId
    );

    if (parentRecords.length === 0) {
      return [];
    }

    // Extract link values for child lookup
    const linkedValues = parentRecords
      .map((record) => record[linkedField])
      .filter(Boolean);

    if (linkedValues.length === 0) {
      return parentRecords.map((parent) => ({
        ...parseJsonData(parent.Data),
        RowId: parent.RowId,
      }));
    }

    // Fetch child data for all records in batch
    const childDataMap = await fetchAllChildData(
      childJobs,
      linkedValues,
      linkedField,
      caseId
    );

    // Merge parent and child data
    const result = parentRecords.map((parent) => {
      const parsedParentData = parseJsonData(parent.Data);
      const linkValue = parent[linkedField];
      const priorityObject = { ...parsedParentData };
      const childRecordsByType: Record<string, any[]> = {};

      // Add all relevant child records
      for (const job of childJobs) {
        const childRecords =
          childDataMap.get(job.DBTableName)?.get(linkValue) || [];

        // Store child records for tracking
        const uniqueKey = `${job.JobTypeName}_${job.DBTableName}`;
        childRecordsByType[uniqueKey] = [];

        if (childRecords.length > 0) {
          const parsedChildData = childRecords.map((child) => {
            const parsed = parseJsonData(child.Data);
            return {
              ...parsed,
              RowId: child.RowId,
              __tableName: job.DBTableName,
              __jobTypeName: job.JobTypeName,
            };
          });

          childRecordsByType[uniqueKey] = parsedChildData;

          // Add to priority object based on HasSiblings flag
          const subformKey = `${job.ScreenName}_SUBFORM`;

          if (job.HasSiblings) {
            priorityObject[subformKey] = parsedChildData.map(
              ({ RowId, __tableName, __jobTypeName, ...childData }) => childData
            );
          } else if (parsedChildData.length > 0) {
            if (parsedChildData.length > 1) {
              console.warn(
                `Found ${parsedChildData.length} child records for ${job.ScreenName}, but HasSiblings=false. Using first record only.`
              );
            }
            const {
              RowId,
              __tableName,
              __jobTypeName,
              ...childWithoutMetadata
            } = parsedChildData[0];
            priorityObject[subformKey] = childWithoutMetadata;
          }
        }
      }

      return {
        ...priorityObject,
        RowId: parent.RowId,
        childRecords: childRecordsByType,
      };
    });

    return result;
  } finally {
    if (startMonitoring && perfMonitor) {
      perfMonitor.endDbFetch();
    }
  }
}

/**
 * Fetches eligible parent records with support for custom WHERE conditions
 * @param tableName The database table to query
 * @param startRow The row ID to start from
 * @param limit Maximum number of records to return
 * @param linkedField Field linking parent and child records
 * @param customWhereClause Optional custom WHERE conditions to apply
 * @returns Array of parent records matching the criteria
 */
async function fetchEligibleParentRecords(
  tableName: string,
  startRow: number,
  limit: number,
  linkedField: string,
  customWhereClause?: string,
  caseId?: string
): Promise<any[]> {
  try {
    console.log(
      `fetchEligibleParentRecords called with customWhereClause: ${customWhereClause}`
    );

    // Add query hint to optimize execution
    const baseWhereClause = "is_eligible = 1 AND is_new = 1";
    let whereClause = `RowId > @startRow AND ${baseWhereClause}`;

    if (caseId) {
      whereClause += ` AND case_id = @caseId`;
    }

    if (customWhereClause) {
      whereClause = `${whereClause} AND (${customWhereClause})`;
    }

    // Add OPTION hints for query optimization
    const query = `
      SELECT RowId, Data, ${linkedField}
      FROM ${tableName} WITH (NOLOCK)
      WHERE ${whereClause}
      ORDER BY RowId ASC
      OFFSET 0 ROWS
      FETCH NEXT @limit ROWS ONLY
      OPTION (OPTIMIZE FOR UNKNOWN, MAXDOP 4)`;

    // Add case_id to query parameters
    const params: any = {
      startRow,
      limit,
    };

    if (caseId) {
      params.caseId = caseId;
    }

    const results = await DatabaseService.executeQuery(query, params);
    return results;
  } catch (error) {
    console.error(`Error in fetchEligibleParentRecords: ${error}`);
    throw error;
  }
}

/**
 * Builds hierarchical structure of child data using Maps
 */
async function fetchAllChildData(
  childJobs: ChildJob[],
  linkedValues: any[],
  linkedField: string,
  caseId?: string
): Promise<Map<string, Map<any, any[]>>> {
  const childDataMap = new Map<string, Map<any, any[]>>();

  await Promise.all(
    childJobs.map(async (childJob) => {
      const mapKey = childJob.DBTableName;
      const childRecords = await fetchChildRecords(
        childJob.DBTableName,
        linkedField,
        linkedValues,
        caseId
      );

      const innerMap = new Map<any, any[]>();

      for (const record of childRecords) {
        const linkValue = record[linkedField];
        if (!innerMap.has(linkValue)) {
          innerMap.set(linkValue, []);
        }
        innerMap.get(linkValue)!.push(record);
      }

      childDataMap.set(mapKey, innerMap);
    })
  );

  return childDataMap;
}

/**
 * Fetches child records by link values
 */
async function fetchChildRecords(
  tableName: string,
  linkFieldName: string,
  linkValues: any[],
  caseId?: string
): Promise<any[]> {
  if (linkValues.length === 0) return [];

  // For small sets, use IN clause
  if (linkValues.length <= 1000) {
    const placeholders = linkValues.map((_, i) => `@p${i}`).join(",");
    const params: any = {};

    linkValues.forEach((value, i) => {
      params[`p${i}`] = value;
    });

    // Add case_id to parameters if provided
    if (caseId) {
      params.caseId = caseId;
    }

    let query = `SELECT RowId, Data, ${linkFieldName}
       FROM ${tableName}
       WHERE ${linkFieldName} IN (${placeholders})
       AND is_eligible = 1`;

    // Add case_id filter to WHERE clause if provided
    if (caseId) {
      query += ` AND case_id = @caseId`;
    }

    query += ` ORDER BY RowId ASC`;

    return await DatabaseService.executeQuery(query, params);
  }

  // For larger sets, use temp table approach
  return await fetchChildRecordsWithTempTable(
    tableName,
    linkFieldName,
    linkValues,
    caseId
  );
}

/**
 * Fetches child records using a temporary table for many link values
 */
async function fetchChildRecordsWithTempTable(
  tableName: string,
  linkFieldName: string,
  linkValues: any[],
  caseId?: string
): Promise<any[]> {
  // Use global temporary table (note the double ##)
  const tempTableName = `##Temp_LinkValues_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    // Create temporary table
    await DatabaseService.executeQuery(`
      CREATE TABLE ${tempTableName} (LinkValue NVARCHAR(255))
    `);

    // Insert values in batches
    const batchSize = 1000;
    for (let i = 0; i < linkValues.length; i += batchSize) {
      const batch = linkValues.slice(i, i + batchSize);
      const params: any = {};
      const valuePlaceholders = batch.map((_, idx) => `(@p${idx})`).join(",");

      batch.forEach((value, idx) => {
        params[`p${idx}`] = value;
      });

      await DatabaseService.executeQuery(
        `INSERT INTO ${tempTableName} (LinkValue) VALUES ${valuePlaceholders}`,
        params
      );
    }

    // Initialize query parameters
    const params: any = {};
    if (caseId) {
      params.caseId = caseId;
    }

    // Fetch linked records using the temp table
    let query = `
      SELECT c.RowId, c.Data, c.${linkFieldName}
      FROM ${tableName} c
      INNER JOIN ${tempTableName} t ON c.${linkFieldName} = t.LinkValue
      WHERE c.is_eligible = 1`;

    // Add case_id filter to WHERE clause if provided
    if (caseId) {
      query += ` AND c.case_id = @caseId`;
    }

    query += ` ORDER BY c.RowId ASC`;

    return await DatabaseService.executeQuery(query, params);
  } finally {
    // Clean up temp table - add error handling
    try {
      await DatabaseService.executeQuery(
        `DROP TABLE IF EXISTS ${tempTableName}`
      );
    } catch (cleanupError) {
      console.warn(
        `Error cleaning up temp table ${tempTableName}:`,
        cleanupError
      );
    }
  }
}

/**
 * Parses JSON data with error handling
 */
function parseJsonData(data: string): any {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error("Error parsing JSON data:", error);
    return {};
  }
}
