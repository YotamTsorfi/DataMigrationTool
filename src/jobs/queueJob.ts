import { v4 as uuidv4 } from "uuid";
import { fetchDataChunk } from "../services/dataService";
import { configService } from "../config/configService";
import PerformanceMonitor from "../utils/performanceMonitor";
import ProgressTracker from "../utils/progressTracker";
import { QueueProcessor, QueueItem } from "../services/queueProcessor";
import { performBulkUpdateWithService, performBulkErrorInsertWithService } from "../services/dataService";
import { DatabaseService } from "../services/databaseService";

/**
 * Process records using grid-based processing (horizontal parallel, vertical sequential)
 */
export async function processWithQueues(
  recordCount: number,
  startRow: number,
  tableName: string,
  priorityScreenName: string,
  jobType: string,
  jobId: string
): Promise<any[]> {
  // console.log(`==== Queue Processing Performance Log - Job: ${jobId} ====`);
  const overallStartTime = Date.now();

  // Get system configuration
  const config = await configService.getConfig();

  // Set horizontal batch size from configuration or use default
  const HORIZONTAL_BATCH_SIZE = parseInt(
    config.HORIZONTAL_BATCH_SIZE || "10",
    10
  );
  // Set vertical batch size from configuration or use default
  const VERTICAL_BATCH_SIZE = parseInt(config.VERTICAL_BATCH_SIZE || "5", 10);

  // Set chunk size for processing
  // This is the number of rows to process in each database fetch operation
  const CHUNK_SIZE = 1000;

  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount);

  // Process in chunks
  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;

  // Performance tracking
  let totalDbFetchTime = 0;
  let totalQueueBuildTime = 0;
  let totalQueueProcessTime = 0;
  let totalDbUpdateTime = 0;
  let chunkCount = 0;

  // console.log(
  //   `Queue configuration: ${HORIZONTAL_BATCH_SIZE} horizontal queues, ${VERTICAL_BATCH_SIZE} records per vertical batch`
  // );

  while (processedCount < recordCount) {
    chunkCount++;
    // console.log(`\n---- Processing chunk ${chunkCount} ----`);
    const chunkStartTime = Date.now();
    const chunkSize = Math.min(CHUNK_SIZE, recordCount - processedCount);

    // Fetch data chunk from database
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();
    // console.log(
    //   `Fetching ${chunkSize} records from ${tableName} starting from RowId > ${lastRowId}...`
    // );
    const dbFetchStartTime = Date.now();
    const rows = await fetchDataChunk(tableName, lastRowId, chunkSize);
    const dbFetchTime = Date.now() - dbFetchStartTime;
    totalDbFetchTime += dbFetchTime;
    perfMonitor.endDbFetch();

    // console.log(`DB Fetch completed: ${rows.length} rows in ${dbFetchTime}ms`);

    if (rows.length === 0) {
      // console.log(`No more rows found, exiting chunk processing`);
      break;
    }

    // Divide the rows into horizontal and vertical batches
    // console.log(`Building queues for ${rows.length} records...`);
    const queueBuildStartTime = Date.now();
    perfMonitor.startQueueBuild(); // Start tracking queue build time using perfMonitor

    // Create queue processors for horizontal batches
    const horizontalQueues: QueueProcessor[] = [];
    for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
      horizontalQueues.push(
        new QueueProcessor(`queue-${h}`, jobId, jobType, tableName)
      );
    }

    // Divide data into queues
    for (
      let i = 0;
      i < rows.length;
      i += HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE
    ) {
      const horizontalBatch = rows.slice(
        i,
        i + HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE
      );

      // Divide the horizontal batch into vertical batches
      for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
        const startIndex = h * VERTICAL_BATCH_SIZE;
        const verticalBatch = horizontalBatch.slice(
          startIndex,
          startIndex + VERTICAL_BATCH_SIZE
        );

        if (verticalBatch.length === 0) continue;

        // Add all rows from the vertical batch to the appropriate queue
        const queueItems: QueueItem[] = verticalBatch.map((row, vIndex) => {
          const batchId = uuidv4();

          return {
            row: row,
            index: i + startIndex + vIndex + processedCount,
            queueId: `queue-${h}`,
            jobId,
            batchId,
            jobType,
            tableName,
            priorityScreenName,
          };
        });

        horizontalQueues[h].addItems(queueItems);
      }
    }

    // End queue build timing - moved here to ensure it only measures queue building
    perfMonitor.endQueueBuild();
    const totalQueueBuildTimeForThisChunk = Date.now() - queueBuildStartTime;
    totalQueueBuildTime += totalQueueBuildTimeForThisChunk;

    // console.log(
    //   `Queues built in ${totalQueueBuildTimeForThisChunk}ms. Processing ${horizontalQueues.filter((q) => q.hasItems()).length} active queues in parallel...`
    // );

    // Now process the queues in parallel - this is a separate operation from queue building
    for (let i = 0; i < horizontalQueues.length; i += HORIZONTAL_BATCH_SIZE) {
      const batchQueues = horizontalQueues
        .slice(i, i + HORIZONTAL_BATCH_SIZE)
        .filter((q) => q.hasItems());

      if (batchQueues.length === 0) continue;

      // Process each queue in parallel
      const queueProcessStartTime = Date.now();
      const queuePromises = batchQueues.map((queue) => queue.process());

      const queueResults = await Promise.all(queuePromises);
      const queueProcessTime = Date.now() - queueProcessStartTime;
      totalQueueProcessTime += queueProcessTime;

      // console.log(`Batch of queues processed in ${queueProcessTime}ms`);

      // Aggregate results from all queues
      // console.log(`Updating database with queue processing results...`);
      for (let qIndex = 0; qIndex < queueResults.length; qIndex++) {
        const result = queueResults[qIndex];
        results.push(result);
        totalSuccessCount += result.successCount;
        totalFailureCount += result.failureCount;

        // Get the result data for this queue to update the database
        const resultData = batchQueues[qIndex].getResultData();

        // Update the database with the results
        const dbUpdateStartTime = Date.now();
        await processQueueResults(resultData, tableName);
        const dbUpdateTime = Date.now() - dbUpdateStartTime;
        totalDbUpdateTime += dbUpdateTime;

        // Comment out the detailed per-queue logs
        // console.log(
        //   `Queue ${qIndex + 1}/${queueResults.length}: ${result.successCount} successful, ${result.failureCount} failed, DB update time: ${dbUpdateTime}ms`
        // );
      }

      // Update progress tracker with the total processed count
      ProgressTracker.updateProgress(
        jobId,
        totalSuccessCount + totalFailureCount,
        totalSuccessCount,
        totalFailureCount
      );
    }

    // Update the last processed row ID for the next chunk
    lastRowId = (rows[rows.length - 1] as { RowId: number }).RowId;
    processedCount += rows.length;

    const chunkTime = Date.now() - chunkStartTime;
    // console.log(
    //   `Chunk ${chunkCount} processing completed in ${chunkTime}ms (${rows.length} records)`
    // );
  }

  // Finalize progress tracking for this job
  ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

  const overallTime = Date.now() - overallStartTime;

  // Fix the calculation of time percentages to ensure they're accurate
  // and don't exceed the total time
  const dbFetchTimePercentage = Math.min(
    (totalDbFetchTime / overallTime) * 100,
    100
  ).toFixed(1);

  const queueBuildTimePercentage = Math.min(
    (totalQueueBuildTime / overallTime) * 100,
    100
  ).toFixed(1);

  // Don't subtract queue build time from process time - they're separate activities
  // measured separately by the performance monitor
  const queueProcessTimePercentage = Math.min(
    (totalQueueProcessTime / overallTime) * 100,
    100
  ).toFixed(1);

  const dbUpdateTimePercentage = Math.min(
    (totalDbUpdateTime / overallTime) * 100,
    100
  ).toFixed(1);

  // Keep the final performance summary logs
  console.log("\n==== Queue Processing Performance Summary ====");
  console.log(
    `Total time: ${overallTime}ms (${(overallTime / 1000).toFixed(2)}s)`
  );
  console.log(
    `Database fetch time: ${totalDbFetchTime}ms (${dbFetchTimePercentage}%)`
  );
  console.log(
    `Queue building time: ${totalQueueBuildTime}ms (${queueBuildTimePercentage}%)`
  );
  console.log(
    `API & Queue processing time: ${totalQueueProcessTime}ms (${queueProcessTimePercentage}%)`
  );
  console.log(
    `Database update time: ${totalDbUpdateTime}ms (${dbUpdateTimePercentage}%)`
  );
  console.log(
    `Records processed: ${totalSuccessCount + totalFailureCount} (${totalSuccessCount} successful, ${totalFailureCount} failed)`
  );
  console.log(
    `Average time per record: ${(overallTime / (totalSuccessCount + totalFailureCount)).toFixed(2)}ms`
  );
  console.log("===============================================");

  // Return only the summary of results for each queue
  return results.map((result) => ({
    success: result.success,
    totalProcessed: result.totalProcessed,
    successCount: result.successCount,
    failureCount: result.failureCount,
    duration: result.duration,
  }));
}

// Process queue results by updating the database and inserting error logs
async function processQueueResults(
  resultData: {
    updateRows: any[];
    errorRows: any[];
    successCount: number;
    failureCount: number;
    lastProcessedIndex: number;
  },
  tableName: string
): Promise<void> {
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();

  try {
    // Check if required fields are present in update rows
    resultData.updateRows.forEach((row, index) => {
      if (!row.RowId || !row.Status || !row.BatchId || !row.JobId) {
        console.warn(`Row at index ${index} is missing required fields:`, row);
      }
    });

    // Check table structure to determine available columns
    const tableColumns = await DatabaseService.executeQuery(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = '${tableName}'
    `);

    // Create a map of column names for easy lookup
    const availableColumns = new Set();
    tableColumns.forEach((col: any) => {
      availableColumns.add(col.COLUMN_NAME);
    });

    // Check if error message column exists and get its name
    const errorColumn = availableColumns.has("ErrorMessage")
      ? "ErrorMessage"
      : availableColumns.has("Error")
        ? "Error"
        : null;

    if (!errorColumn) {
      console.warn(
        `No error column found in table ${tableName}, error details may be lost`
      );
    }

    // For update rows, process possible error message truncation
    resultData.updateRows.forEach((row) => {
      // Truncate error messages if necessary
      if (row.ErrorMessage && row.ErrorMessage.length > 3800) {
        row.ErrorMessage = row.ErrorMessage.substring(0, 3800);
      }
    });

    // Perform bulk update with service - this is a placeholder for the actual service call
    await performBulkUpdateWithService(
      tableName,
      resultData.updateRows,
      perfMonitor,
      1000, // Batch size for bulk update
      3, //  Maximum number of retries
      true // Sent to Priority screen
    );

    // console.log(`Successfully updated ${resultData.updateRows.length} rows in ${tableName}`);
  } catch (error) {
    console.error(`Error updating rows in ${tableName}:`, error);

    // This is a fallback mechanism to ensure that we try to update each row individually
    console.log(`Trying to update rows individually`);
    for (const row of resultData.updateRows) {
      try {
        // Check if Error column exists in table
        const errorColumnQuery = `
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = '${tableName}' 
          AND COLUMN_NAME IN ('ErrorMessage', 'Error')
        `;
        const errorColumns = (await DatabaseService.executeQuery(
          errorColumnQuery
        )) as { COLUMN_NAME: string }[];
        const errorColumn =
          errorColumns.length > 0 ? errorColumns[0].COLUMN_NAME : null;

        let query = `
          UPDATE ${tableName}
          SET Status = @Status, 
              BatchId = @BatchId, 
              JobName = @JobName`;

        if (errorColumn) {
          query += `, ${errorColumn} = @ErrorValue`;
        }

        query += ` WHERE RowId = @RowId`;

        const params: any = {
          Status: row.Status,
          BatchId: row.BatchId,
          JobName: row.JobName,
          RowId: row.RowId,
        };

        if (errorColumn) {
          // Truncate error message if needed
          const errorValue = row.ErrorMessage || row.Error || null;
          params.ErrorValue =
            errorValue && errorValue.length > 3800
              ? errorValue.substring(0, 3800)
              : errorValue;
        }

        await DatabaseService.executeQuery(query, params);
      } catch (innerError) {
        console.error(`Failed to update row ${row.RowId}:`, innerError);
      }
    }
  }

  // Insert error logs
  if (resultData.errorRows.length > 0) {
    try {
      await performBulkErrorInsertWithService(
        resultData.errorRows,
        perfMonitor
      );
    } catch (error) {
      console.error("Error inserting error logs for queue results:", error);
    }
  }

  perfMonitor.endOperation();
  const metrics = perfMonitor.getFormattedMetrics();
  // console.log(`Queue results processing completed in ${metrics.totalDuration}ms`);
}