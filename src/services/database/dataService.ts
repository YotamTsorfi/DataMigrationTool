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
  caseId?: string
): Promise<any[]> {
  console.log(
    `fetchDataChunk called with customWhereClause: ${customWhereClause}`
  );

  try {
    // Fetch raw data using DatabaseService
    const rawData = await DatabaseService.fetchDataChunk(
      tableName,
      lastRowId,
      chunkSize,
      customWhereClause,
      caseId
    );

    // Transform raw data by parsing JSON and flattening structure
    return transformDatabaseRecords(rawData);
  } catch (error) {
    console.error("Error fetching and transforming data chunk:", error);
    throw error;
  }
}

/**
 * Transforms raw database records by parsing JSON data and flattening the structure
 *
 * @param records - Raw database records containing RowId and Data fields
 * @returns Array of transformed records with RowId and parsed JSON data
 */
export function transformDatabaseRecords(
  records: Array<{ RowId: number; Data: string }>
): any[] {
  try {
    return records.map((record) => ({
      RowId: record.RowId,
      ...JSON.parse(record.Data),
    }));
  } catch (error) {
    console.error("Error transforming database records:", error);
    throw new Error(
      `Failed to transform database records: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
