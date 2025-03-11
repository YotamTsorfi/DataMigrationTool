/**
 * Builds a batch request body with proper boundary formatting
 */
export function buildBatchRequestBody(rows: any[], boundary: string): string {
  let batchBody = "";

  rows.forEach((row: any) => {
    const { RowId, __batchId, __jobType, __tableName, __jobId, __priorityScreenName, ...rowData } = row; // Remove metadata from row object
    batchBody += `--${boundary}\r\n`;
    batchBody += `Content-Type: application/http\r\n`;
    batchBody += `Content-Transfer-Encoding: binary\r\n\r\n`;
    batchBody += `POST ${__priorityScreenName || ""} HTTP/1.1\r\n`;
    batchBody += `Content-Type: application/json\r\n\r\n`;
    batchBody += `${JSON.stringify(rowData)}\r\n`;
  });

  batchBody += `--${boundary}--\r\n`;
  
  // DEBUG: Log the request body format
//   console.log("===== BATCH REQUEST BODY FORMAT =====");
//   console.log("First 500 chars:", batchBody.substring(0, 500) + "...");
//   console.log("Last 200 chars:", "..." + batchBody.substring(batchBody.length - 200));
//   console.log("Total length:", batchBody.length);
//   console.log("=================================");
  
  return batchBody;
}

/**
 * Creates the headers needed for batch requests
 */
export function createBatchHeaders(boundary: string, authToken: string): Record<string, string> {
  return {
    "Content-Type": `multipart/mixed;boundary=${boundary}`,
    Authorization: authToken,
    Connection: "keep-alive",
  };
}

/**
 * Generates a unique boundary string for multipart requests
 */
export function generateBoundary(): string {
  return `batch_${Date.now()}`;
}
