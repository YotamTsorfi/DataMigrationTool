/**
 * This file contains helper functions for handling child records in parent-child relationships.
 * It includes utilities for finding and processing child records within complex data structures.
 */

/**
 * Gets child records with flexible lookup methods.
 * Tries multiple approaches to find child records, including composite keys,
 * exact matches, case-insensitive matches, and partial matches.
 *
 * @param record - The parent record containing child records
 * @param jobTypeName - The job type name to look for
 * @param tableName - Optional table name for more specific lookup
 * @returns An array of child records if found, otherwise undefined
 */
export function getChildRecords(
  record: any,
  jobTypeName: string,
  tableName?: string
): any[] | undefined {
  if (!record.childRecords) return undefined;

  // Try composite key first if table name is provided
  if (tableName) {
    const compositeKey = `${jobTypeName}_${tableName}`;
    if (record.childRecords[compositeKey]) {
      return record.childRecords[compositeKey];
    }
  }

  // Try exact match with job type name
  if (record.childRecords[jobTypeName]) {
    return record.childRecords[jobTypeName];
  }

  // Try case-insensitive match
  const lcKey = jobTypeName.toLowerCase();
  const ucKey = jobTypeName.toUpperCase();

  if (record.childRecords[lcKey]) {
    return record.childRecords[lcKey];
  }

  if (record.childRecords[ucKey]) {
    return record.childRecords[ucKey];
  }

  // Try partial matches
  for (const key of Object.keys(record.childRecords)) {
    if (key.includes(jobTypeName) || jobTypeName.includes(key)) {
      return record.childRecords[key];
    }
  }

  return undefined;
}
