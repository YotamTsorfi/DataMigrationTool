/**
 * This file contains functions for extracting Priority IDs from API responses.
 * It handles various response formats and structures for both parent and child records.
 */

import { ChildJob } from "../../../types/jobTypes";
import { writeToLogFile } from "../../../config/logger";

/**
 * Logs the full response body when a critical component like a subform key is missing.
 * This helps with debugging API response structure issues.
 *
 * @param subformKey - The missing subform key that triggered the logging
 * @param responseBody - The full response body to log
 * @param childJob - Information about the child job for context
 * @param recordId - The record ID being processed
 */
export function logMissingSubformResponse(
  subformKey: string,
  responseBody: any,
  childJob: ChildJob,
  recordId: string | number,
  originalRequestPayload?: any
): void {
  try {
    // Create a meaningful filename with timestamp for uniqueness
    const filename = `missing_subform_${recordId}.log`;

    // Format the log data with important context information
    const logData = [
      `[MISSING SUBFORM KEY ERROR]`,
      `Record ID: ${recordId}`,
      `Missing Subform Key: ${subformKey}`,
      `Child Job Type: ${childJob.JobTypeName}`,
      `Child Job Table: ${childJob.DBTableName}`,
      `Child Job Screen: ${childJob.ScreenName}`,
      `Original Request Payload:`,
      JSON.stringify(originalRequestPayload, null, 2),
      `Response Body:`,
      JSON.stringify(responseBody, null, 2),
    ].join("\n");

    // Write to log file
    writeToLogFile(filename, logData);

    // Also log to console in a more compact form
    console.log(
      `Subform key ${subformKey} not found in response - logged to ${filename}`
    );
  } catch (loggingError) {
    console.error("Failed to log missing subform response:", loggingError);
  }
}

/**
 * Generic function to extract Priority ID from any response.
 * Works with direct fields, AU fields, and compound patterns.
 *
 * @param responseBody - The API response body to extract from
 * @param idFieldName - The field name to look for
 * @returns The extracted Priority ID or null if not found
 */
export function extractPriorityId(
  responseBody: any,
  idFieldName: string
): string | null {
  // First try direct field access
  if (responseBody && responseBody[idFieldName] !== undefined) {
    const idValue = responseBody[idFieldName];
    return idValue !== null && idValue !== undefined ? String(idValue) : null;
  }

  // Then try special AU fields which might contain the ID
  for (const key of Object.keys(responseBody)) {
    if (key === idFieldName || key.includes("_AU")) {
      const value = responseBody[key];
      if (typeof value === "string" && value.includes("=")) {
        // Extract from pattern like "(FIELDNAME='value')"
        const match = value.match(/'([^']+)'/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
  }

  // Try to find ID patterns in other fields
  for (const key of Object.keys(responseBody)) {
    if (responseBody[key] && typeof responseBody[key] === "string") {
      // Look for typical ID patterns in any field
      const idMatch = responseBody[key].match(/\([A-Z]+=(['"])([^'"]+)\1\)/);
      if (idMatch && idMatch[2]) {
        return idMatch[0];
      }
    }
  }

  return null;
}

/**
 * Extracts the Priority ID for a child record from the API response.
 * Handles various formats and ensures unique IDs for each child record.
 *
 * @param responseBody - The API response body
 * @param childJob - The child job configuration
 * @param childRecord - The child record data
 * @param childIndex - The index of this child within siblings (optional)
 * @returns The extracted Priority ID or null if not found
 */
export function extractChildPriorityId(
  responseBody: any,
  childJob: ChildJob,
  childRecord: any,
  childIndex?: number,
  originalRequestPayload?: any
): string | null {
  // Get the field name from the child job configuration
  const idFieldName = childJob.priority_id;

  if (!idFieldName) {
    return null;
  }

  // Get the subform key based on screen name
  const subformKey = `${childJob.ScreenName}_SUBFORM`;

  // Check if the subform exists
  if (responseBody && responseBody[subformKey]) {
    const subform = responseBody[subformKey];

    // For array of child records (HasSiblings=true)
    if (Array.isArray(subform)) {
      // If we have a specific index, use it to get the corresponding record
      if (
        childIndex !== undefined &&
        childIndex >= 0 &&
        childIndex < subform.length
      ) {
        const matchingRecord = subform[childIndex];

        // First try the configured priority_id field
        if (matchingRecord[idFieldName]) {
          return String(matchingRecord[idFieldName]);
        }

        // Then check for AU fields in this specific record
        for (const key of Object.keys(matchingRecord)) {
          if (key === idFieldName || key.includes("_AU")) {
            const value = matchingRecord[key];
            if (typeof value === "string" && value.includes("=")) {
              return value;
            }
          }
        }
      }
      // If no index is provided or it's invalid, try to match by properties
      else {
        // Try to find a matching record by comparing properties
        for (let i = 0; i < subform.length; i++) {
          const responseRecord = subform[i];
          let matchFound = false;

          // Look for key properties to match (excluding internal fields)
          for (const key of Object.keys(childRecord)) {
            if (
              !key.startsWith("__") &&
              key !== "RowId" &&
              childRecord[key] &&
              responseRecord[key] &&
              childRecord[key] === responseRecord[key]
            ) {
              matchFound = true;
              break;
            }
          }

          if (matchFound) {
            // Found a matching record - extract its ID
            if (responseRecord[idFieldName]) {
              return String(responseRecord[idFieldName]);
            }

            // Check for AU fields in this record
            for (const key of Object.keys(responseRecord)) {
              if (key === idFieldName || key.includes("_AU")) {
                const value = responseRecord[key];
                if (typeof value === "string" && value.includes("=")) {
                  return value;
                }
              }
            }
          }
        }

        // If we couldn't match by properties and we have the index within childRecords
        // Use the same index in the response (assuming ordering is preserved)
        if (
          childIndex !== undefined &&
          childIndex >= 0 &&
          childIndex < subform.length
        ) {
          const indexedRecord = subform[childIndex];

          if (indexedRecord[idFieldName]) {
            return String(indexedRecord[idFieldName]);
          }

          // Check for AU fields in this indexed record
          for (const key of Object.keys(indexedRecord)) {
            if (key === idFieldName || key.includes("_AU")) {
              const value = indexedRecord[key];
              if (typeof value === "string" && value.includes("=")) {
                return value;
              }
            }
          }
        }
      }
    }
    // For single child record (HasSiblings=false)
    else if (typeof subform === "object" && subform !== null) {
      if (subform[idFieldName]) {
        return String(subform[idFieldName]);
      }

      // Check for AU fields in the single subform
      for (const key of Object.keys(subform)) {
        if (key === idFieldName || key.includes("_AU")) {
          const value = subform[key];
          if (typeof value === "string" && value.includes("=")) {
            return value;
          }
        }
      }
    }
  } else {
    console.log(`Subform key ${subformKey} not found in response`);
    // Log the missing subform and full response body to a file
    logMissingSubformResponse(
      subformKey,
      responseBody,
      childJob,
      childRecord.RowId,
      originalRequestPayload
    );
  }

  // Check for direct field access in the response body
  if (responseBody && responseBody[idFieldName]) {
    const idValue = responseBody[idFieldName];
    return idValue !== null && idValue !== undefined ? String(idValue) : null;
  }

  // Try special AU fields which might contain the ID
  for (const key of Object.keys(responseBody)) {
    if (key === idFieldName || key.includes("_AU")) {
      const value = responseBody[key];
      if (typeof value === "string" && value.includes("=")) {
        return value;
      }
    }
  }

  return null;
}
