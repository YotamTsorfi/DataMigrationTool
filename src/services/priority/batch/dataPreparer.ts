import { DatabaseService } from "../../database/databaseService";
import { ChildJob, ParentRecord, ChildRecord } from "../../../types/jobTypes";

//import { Readable, Transform } from 'stream'; // Might be needed in order to use streams in Node.js

//---------------------------------------------------------------------------
/**
 * Streams parent records from the specified table, enriching each with its associated child records
 * according to the provided child job definitions. The function yields each enriched parent record
 * as a JSON object, including child records organized by job type and screen name.
 *
 * The function processes records in batches, starting from a given row and up to a maximum number of rows.
 * For each parent record, it fetches all relevant child records, merges them into the parent object,
 * and yields the result. Child records are included according to the HasSiblings property of each job:
 * - If HasSiblings is true, an array of child objects is added.
 * - If HasSiblings is false, a single child object is added (if available).
 *
 * The function also tracks and logs performance for batch fetching and merging operations.
 *
 * @param parentTableName - The name of the parent table to fetch records from.
 * @param batchSize - The number of parent records to fetch per batch.
 * @param startRow - The RowId to start fetching records from.
 * @param maxRows - The maximum number of parent records to process.
 * @param linkedField - The field name used to link parent and child records.
 * @param childJobs - An array of ChildJob definitions specifying child tables and merge logic.
 * @yields Enriched parent record objects, each including child records and tracking metadata.
 */
export async function* streamParentChildData(
  parentTableName: string,
  batchSize: number,
  startRow: number,
  maxRows: number,
  linkedField: string,
  childJobs: ChildJob[]
): AsyncGenerator<any> {
  let processedRows = 0;
  let currentOffset = startRow;

  while (processedRows < maxRows) {
    const currentBatchSize = Math.min(batchSize, maxRows - processedRows);

    const shouldLog = processedRows % 1000 === 0;
    if (shouldLog) {
      console.time(`Fetch parent records ${currentOffset}`);
    }

    const parentRecords = await fetchEligibleParentRecords(
      parentTableName,
      currentOffset,
      currentBatchSize,
      linkedField,
      startRow
    );
    if (shouldLog) {
      console.timeEnd(`Fetch parent records ${currentOffset}`);
    }

    if (parentRecords.length === 0) {
      console.log(
        `No more parent records available at offset ${currentOffset}`
      );
      break;
    }

    const linkedValues = parentRecords.map((record) => record[linkedField]);
    // console.log(`Extracted ${linkedValues.length} linked values from parent records`);

    const label = `Fetch child data for ${linkedValues.length} parents`;
    console.time(label);
    const childDataMap = await fetchAllChildData(
      childJobs,
      linkedValues,
      linkedField
    );
    console.timeEnd(label);

    for (const parent of parentRecords) {
      const mergeLabel = `Merge parent-child JSON for parent ${parent.RowId}`;
      console.time(mergeLabel);

      const linkValue = parent[linkedField];
      const parsedParentData = parseJsonData(parent.Data);

      const priorityObject = parsedParentData;

      // Create a tracking structure to store child records by job type
      const childRecordsByType: Record<string, any[]> = {};

      // Iterate over each child job to merge child records
      for (const job of childJobs) {
        const childRecords =
          childDataMap.get(job.DBTableName)?.get(linkValue) || [];

        // Initialize the child records array for this job type
        childRecordsByType[job.JobTypeName] = [];

        if (childRecords.length === 0) {
          // No child records for this job type, continue to next job
          continue;
        }

        // Preserve both parsed data AND RowId for each child record
        const parsedChildData = childRecords.map((child) => {
          const parsed = parseJsonData(child.Data);
          return {
            ...parsed,
            RowId: child.RowId, // Add RowId for tracking
            __tableName: job.DBTableName, // Add tableName for consistency
            __jobTypeName: job.JobTypeName, // Add job type name for better debugging
          };
        });

        // Store child records for tracking (by job type)
        //OLD
        //childRecordsByType[job.JobTypeName] = parsedChildData;

        // Store child records with unique key
        const uniqueKey = `${job.JobTypeName}_${job.DBTableName}`;
        childRecordsByType[uniqueKey] = parsedChildData;

        // Add the child records to the priority object under the appropriate subform key
        const subformKey = `${job.ScreenName}_SUBFORM`;

        // If HasSiblings is true, we add an array of child objects
        if (job.HasSiblings) {
          if (parsedChildData.length > 0) {
            priorityObject[subformKey] = parsedChildData.map((item) => {
              const {
                RowId,
                __tableName,
                __jobTypeName,
                ...childWithoutMetadata
              } = item;
              return childWithoutMetadata;
            });
          }
          // If HasSiblings is false, we add a single child object
        } else {
          if (parsedChildData.length > 0) {
            if (parsedChildData.length > 1) {
              console.warn(
                `נמצאו ${parsedChildData.length} רשומות ילד עבור ${job.ScreenName}, אך HasSiblings=false. משתמש ברשומה הראשונה בלבד.`
              );
            }

            // Use the first child record for this job type
            // Remove metadata fields before adding to priority object
            const {
              RowId,
              __tableName,
              __jobTypeName,
              ...childWithoutMetadata
            } = parsedChildData[0];
            priorityObject[subformKey] = childWithoutMetadata;
          }
          // If no child records, we leave the subform key undefined
        }
      }

      // Include the RowId in the object for tracking purposes
      const priorityObjectWithTracking = {
        ...priorityObject,
        RowId: parent.RowId, // Preserve RowId for error tracking
        childRecords: childRecordsByType, // Organized child records with RowIds
      };

      // Add console log to inspect if child RowIds are preserved
      // console.log('Priority object with tracking:', JSON.stringify(priorityObjectWithTracking, null, 2));
      // Yield the enriched object
      console.timeEnd(mergeLabel);

      yield priorityObjectWithTracking;

      processedRows++;
    }

    // Get the highest RowId from this batch to use as the next starting point
    const lastRowId = Math.max(...parentRecords.map((record) => record.RowId));
    currentOffset = lastRowId + 1; // Start after the highest RowId we've seen

    // console.log(`Next batch will start at RowId ${currentOffset}`);
  }
}
//---------------------------------------------------------------------------
/**
 * Fetches all child records for the given child jobs and linked values.
 */
async function fetchAllChildData(
  childJobs: ChildJob[],
  linkedValues: any[],
  linkedField: string
): Promise<Map<string, Map<any, ChildRecord[]>>> {
  const childDataMap = new Map<string, Map<any, ChildRecord[]>>();

  await Promise.all(
    childJobs.map(async (childJob) => {
      const mapKey = childJob.DBTableName;

      const childRecords = await fetchChildRecords(
        childJob.DBTableName,
        linkedField,
        linkedValues
      );

      const innerMap = new Map<any, ChildRecord[]>();

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
//---------------------------------------------------------------------------
/**
 * Fetches eligible parent records from the specified table with pagination.
 */
async function fetchEligibleParentRecords(
  tableName: string,
  offset: number,
  limit: number,
  linkedField: string,
  startRow: number
): Promise<ParentRecord[]> {
  try {
    // console.log(`Starting to fetch parent records from ${tableName}`);
    const query = `
        SELECT TOP ${limit} RowId, Data, ${linkedField}
        FROM ${tableName}
        WHERE is_eligible = 1
        AND is_new = 1
        AND Status IS NULL
        AND RowId >= @startRow
        ORDER BY RowId ASC
      `;

    // console.log(`Fetching parent records from ${tableName} with offset ${offset}, limit ${limit}`);
    const results = await DatabaseService.executeQuery(query, { startRow });
    // console.log(`Finished fetching ${results?.length || 0} parent records`);
    return results as ParentRecord[];
  } catch (error) {
    console.error(`Error in fetchEligibleParentRecords: ${error}`);
    throw error;
  }
}
//---------------------------------------------------------------------------
/**
 * Fetches child records based on a list of link values.
 * Uses a tailored query to efficiently handle a large number of values.
 */
async function fetchChildRecords(
  tableName: string,
  linkFieldName: string,
  linkValues: any[]
): Promise<ChildRecord[]> {
  if (linkValues.length === 0) {
    return [];
  }

  // Check if this is a large number of values and use a temporary table if necessary
  if (linkValues.length > 2000) {
    return await fetchChildRecordsWithTempTable(
      tableName,
      linkFieldName,
      linkValues
    );
  }

  const placeholders = linkValues.map((_, i) => `@p${i}`).join(", ");
  const params: any = {};
  linkValues.forEach((val, i) => {
    params[`p${i}`] = val;
  });

  const query = `
    SELECT RowId, Data, ${linkFieldName}
    FROM ${tableName}
    WHERE ${linkFieldName} IN (${placeholders})
    AND is_eligible = 1
    AND is_new = 1
    AND Status IS NULL
    ORDER BY RowId ASC
  `;

  // console.log(`Fetching ${linkValues.length} child records from ${tableName}`);
  return await DatabaseService.executeQuery(query, params);
}
//---------------------------------------------------------------------------
/**
 * Fetches child records with a temporary table for a large number of link values.
 */
async function fetchChildRecordsWithTempTable(
  tableName: string,
  linkFieldName: string,
  linkValues: any[]
): Promise<ChildRecord[]> {
  const tempTableName = `#Temp_LinkValues_${Date.now()}`;

  try {
    // Create the temporary table
    await DatabaseService.executeQuery(`
      CREATE TABLE ${tempTableName} (LinkValue NVARCHAR(255))
    `);

    // Insert link values into the temporary table in batches
    // This prevents SQL Server from hitting the maximum number of parameters limit
    const batchSize = 1000;
    for (let i = 0; i < linkValues.length; i += batchSize) {
      const batch = linkValues.slice(i, i + batchSize);
      const valuePlaceholders = batch.map(() => "(?)").join(",");
      await DatabaseService.executeQuery(
        `
        INSERT INTO ${tempTableName} (LinkValue)
        VALUES ${valuePlaceholders}
      `,
        batch
      );
    }

    // Fetch the child records using the temporary table
    return await DatabaseService.executeQuery(`
      SELECT c.RowId, c.Data, c.${linkFieldName}
      FROM ${tableName} c
      INNER JOIN ${tempTableName} t ON c.${linkFieldName} = t.LinkValue
      WHERE c.is_eligible = 1
      ORDER BY c.RowId ASC
    `);
  } finally {
    // Clean up the temporary table
    await DatabaseService.executeQuery(`DROP TABLE IF EXISTS ${tempTableName}`);
  }
}
//---------------------------------------------------------------------------
/**
 * Parses JSON data from a string.
 */
function parseJsonData(jsonString: string): any {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn(`Failed to parse JSON data: ${error}`);
    return {};
  }
}
