/**
 * This module provides utility functions for date and time operations,
 * particularly for handling timezone adjustments when working with dates
 * across different systems or database operations.
 */

/**
 * Adjusts a date to the local timezone by removing the timezone offset.
 * This is useful when working with date objects that need to be displayed
 * or stored with the correct local time representation.
 *
 * @param date - The date object to adjust
 * @returns A new Date object adjusted to the local timezone
 */
export const adjustTimeZone = (date: Date): Date => {
  const offset = date.getTimezoneOffset() * 60000; // offset in milliseconds
  return new Date(date.getTime() - offset);
};

/**
 * Formats a date as an ISO string with the timezone adjustment applied.
 * Useful for consistent date formatting across the application.
 *
 * @param date - The date to format
 * @returns ISO string representation with timezone adjustment
 */
export const formatAdjustedDate = (date: Date): string => {
  return adjustTimeZone(date).toISOString();
};

/**
 * Creates a new Date object set to the current time with timezone adjustment.
 *
 * @returns A new Date object for the current time with timezone adjustment
 */
export const getCurrentAdjustedDate = (): Date => {
  return adjustTimeZone(new Date());
};

export function formatTime(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return `${hrs}h ${mins}m`;
}
