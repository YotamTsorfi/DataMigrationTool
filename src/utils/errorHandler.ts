import axios from "axios";
import { writeToLogFile } from "../config/logger";

export function formatAxiosError(error: any): string {
  if (axios.isAxiosError(error)) {
    return `${error.code || "API Error"}: ${error.message} (${error.config?.url || "unknown URL"})`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatErrorMessage(error: any): string {
  // API errors
  if (axios.isAxiosError(error)) {
    // Network errors
    if (error.code === "ECONNREFUSED") {
      return `Connection refused: Unable to reach ${error.config?.url || "API endpoint"}`;
    } else if (error.code === "ETIMEDOUT") {
      return `Connection timeout: ${error.config?.url || "API endpoint"} took too long to respond`;
    }

    // Response errors
    if (error.response) {
      if (error.response.status === 401 || error.response.status === 403) {
        return `Authentication error: ${error.message}`;
      } else if (error.response.status === 404) {
        return `Resource not found: ${error.config?.url || "unknown URL"}`;
      }
    }

    return `${error.code || "API Error"}: ${error.message}`;
  }

  // Database errors
  if (error.number === 1205 || error.originalError?.info?.number === 1205) {
    return "Database deadlock detected - operation will be retried automatically";
  }

  // For regular errors, just return the message without the stack
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function logAxiosError(error: any, context: string = ""): void {
  // Log detailed error for debugging but display simplified message
  if (axios.isAxiosError(error)) {
    // Log detailed error to file
    writeToLogFile(
      "error.log",
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          context,
          message: error.message,
          code: error.code,
          config: error.config,
          status: error.response?.status,
          data: error.response?.data,
        },
        null,
        2,
      ),
    );

    // Print simplified message to console
    // console.error(`${context} Error: ${formatAxiosError(error)}`);
  } else {
    // For non-Axios errors
    // console.error(`${context} Error:`, error.message || error);
    writeToLogFile(
      "error.log",
      `${new Date().toISOString()} - ${context} - ${error.message || error}`,
    );
  }
}

/**
 * Creates a clean error object without stack trace for user-facing error messages
 * @param error Original error
 * @param context Optional context to add to the error message
 * @returns A new Error object with clean message and no stack trace
 */
export function createCleanError(error: any, context: string = ""): Error {
  // Log the original error with full details
  if (context) {
    // logAxiosError(error, context);
  }

  // Create a new error with clean message
  const cleanError = new Error(formatErrorMessage(error));

  // Remove stack trace
  Object.defineProperty(cleanError, "stack", {
    value: undefined,
    configurable: true,
  });

  return cleanError;
}
