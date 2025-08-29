/**
 * This module provides utility functions for error message processing and formatting.
 * These utilities help standardize error handling across the application.
 */

/**
 * Generates a clean error message by removing numbers and special characters,
 * while preserving Hebrew and English letters and spaces.
 *
 * @param errorMessage - The original error message to clean
 * @returns A cleaned version of the error message or null if input is null
 */
export function generateCleanError(errorMessage: string | null): string | null {
  if (!errorMessage) return null;
  return errorMessage
    .replace(/[0-9]/g, "") // Remove all numbers
    .replace(/[^\p{L}\s]/gu, "") // Keep only letters (including Hebrew/English) and spaces
    .trim();
}

/**
 * Ensures error messages don't exceed database column size limits.
 * Handles Redis timeout errors and other common API issues while preserving essential information.
 *
 * @param errorMessage - The original error message
 * @param maxLength - Maximum allowed length (default 500 characters)
 * @returns Truncated and formatted error message
 */
export function truncateErrorForDatabase(
  errorMessage: string | null,
  maxLength: number = 500
): string | null {
  if (!errorMessage) return null;

  try {
    // Check if it's a JSON error and extract just the essential parts
    if (errorMessage.startsWith("{") && errorMessage.includes('"code"')) {
      try {
        const errorObj = JSON.parse(errorMessage);
        // Extract just the code and a shortened message
        return `Error ${errorObj.code || "Unknown"}: ${(errorObj.message || "").substring(0, maxLength - 20)}`;
      } catch (e) {
        // If JSON parsing fails, continue with normal truncation
      }
    }

    // Handle Redis timeout errors specifically - they tend to be very long
    if (
      errorMessage.includes("Timeout performing") &&
      errorMessage.includes("HGET")
    ) {
      return "Redis timeout error - operation took too long to complete";
    }

    // For other errors, just truncate to fit the column
    return errorMessage.substring(0, maxLength);
  } catch (e) {
    // Failsafe - if anything goes wrong in error processing, return a safe message
    return "Error message processing failed";
  }
}
