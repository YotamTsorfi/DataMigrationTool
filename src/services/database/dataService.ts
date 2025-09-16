/**
 * Data service providing business-specific data operations and transformations
 * for the Carmelton Data Migration Tool. Focuses on data manipulation, JSON parsing,
 * and preparing data for processing by job handlers.
 */
import { DatabaseService } from "./databaseService";

/**
 * Fetches and transforms eligible data chunks from the database for processing
 *
 * This function retrieves records from the specified table that meet the eligibility criteria,
 * then transforms the JSON data into a flattened object structure for easier processing.
 * with support for delta processing and pagination.
 *
 * @param tableName - The source table name
 * @param lastRowId - The ID to start fetching from (for pagination)
 * @param chunkSize - Maximum number of records to fetch
 * @param customWhereClause - Optional additional filtering criteria
 * @param caseId - Optional case ID filter
 * @returns Array of transformed records with flattened structure
 */
export async function fetchDataChunk(
  tableName: string,
  lastRowId: number,
  chunkSize: number,
  customWhereClause?: string,
  caseId?: string,
  isDelta: boolean = false,
  isChildDelta: boolean = false,
  parentTableName?: string
): Promise<any[]> {
  console.log(
    `fetchDataChunk called with customWhereClause: ${customWhereClause}, isDelta: ${isDelta}, isChildDelta: ${isChildDelta}`
  );

  try {
    // Fetch raw data using DatabaseService with delta parameters
    const rawData = await DatabaseService.fetchDataChunk(
      tableName,
      lastRowId,
      chunkSize,
      customWhereClause,
      caseId,
      isDelta ? "is_eligible = 1" : "is_eligible = 1 AND is_new = 1",
      isDelta,
      isChildDelta,
      parentTableName
    );

    // Transform raw data by parsing JSON and flattening structure
    return transformDatabaseRecords(rawData, isDelta);
  } catch (error) {
    console.error("Error fetching and transforming data chunk:", error);
    throw error;
  }
}

/**
 * Transforms raw database records by parsing JSON data and flattening the structure
 * with support for delta metadata
 *
 * @param records - Raw database records containing RowId and Data fields
 * @returns Array of transformed records with RowId and parsed JSON data
 */
export function transformDatabaseRecords(
  records: Array<{
    RowId: number;
    Data: string;
    is_new?: number;
    is_modified?: number;
    priority_id?: string | null;
    reference_id?: string | null;
    parent_priority_id?: string | null;
  }>,
  isDelta: boolean = false
): any[] {
  try {
    return records.map((record) => {
      const parsedData = JSON.parse(record.Data);

      // For delta records, include the metadata
      if (isDelta) {
        return {
          RowId: record.RowId,
          ...parsedData,
          __deltaMetadata: {
            is_new: record.is_new || 0,
            is_modified: record.is_modified || 0,
            priority_id: record.priority_id || null,
            reference_id: record.reference_id || null,
            parent_priority_id: record.parent_priority_id || null,
          },
        };
      }

      // Standard record transformation
      return {
        RowId: record.RowId,
        ...parsedData,
      };
    });
  } catch (error) {
    console.error("Error transforming database records:", error);
    throw new Error(
      `Failed to transform database records: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
