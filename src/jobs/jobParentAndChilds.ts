import { DatabaseService } from "../services/databaseService";
import { streamParentChildData } from '../services/parentChildDataFetcher';
import { sendParentChildBatchesInParallel } from '../services/priorityParentChildSender';
import ProgressTracker from "../utils/progressTracker";
import PerformanceMonitor from "../utils/performanceMonitor";
import { performBulkUpdateWithService, performBulkErrorInsertWithService } from "../services/dataService";

// import { writeToLogFile } from "../config/logger";
export interface ChildJob {
    ChildJobeId: number;
    JobTypeName: string;
    DBTableName: string;
    ScreenName: string;
    priority_id: string;
    HasSiblings: boolean;
  }
  
  interface BatchResult {
    success: boolean;
    successCount?: number;
    failureCount?: number;
    error?: any;
  }
//---------------------------------------------------------------------------
/**
 * Process parent records with their related child records in batches
 */
async function processParentChildBatches(
  totalRecords: number,
  startRow: number,
  parentTableName: string,
  parentScreenName: string,
  jobType: string,
  jobId: string,
  parentIdField: string,
  linkedField: string,
  childJobs: ChildJob[]
): Promise<BatchResult[]> {
  // Debug logging (keep this)
  console.log("------------- DEBUG --------------------");
  console.log("Parent job details:");
  console.log(`  Table Name: ${parentTableName}`);
  console.log(`  Screen Name: ${parentScreenName}`);
  console.log(`  Parent ID Field: ${parentIdField}`);
  console.log(`  Linked Field: ${linkedField}`);
  console.log(`  Job Type: ${jobType}`);
  console.log("------------");
  console.log("Child jobs details:");
  childJobs.forEach((job, index) => {
    console.log(`Child job ${index + 1}:`);
    console.log(`  JobType: ${job.JobTypeName}`);
    console.log(`  TableName: ${job.DBTableName}`);
    console.log(`  ScreenName: ${job.ScreenName}`);
    console.log(`  Priority ID: ${job.priority_id}`);
    console.log(`  HasSiblings: ${job.HasSiblings}`);
  });
  console.log("---------------END DEBUG ---------------------");
  
  // Initialize job tracking
  ProgressTracker.initJob(jobId, totalRecords);
  const overallPerformance = new PerformanceMonitor();
  overallPerformance.startOperation();

  const results: BatchResult[] = [];
  const batchSize = await getBatchSize();
  let processedRecords = 0;
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  
  // Fixed for exactly 100 records per batch
  const maxBatchSizeForApi = 100; 
  
  // Fixed for processing 10 batches in parallel
  const maxConcurrentBatches = 10;
  
  // Add error tracking
  let consecutiveFailedBatches = 0;
  const maxConsecutiveFailures = 3;
  
  try {
    // IMPORTANT FIX: Use a single dataStream for the entire process
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();
    
    console.log(`Fetching data from ${parentTableName} with linked field ${linkedField}`);
    const dataStream = streamParentChildData(
      parentTableName,
      batchSize,
      startRow,
      totalRecords,
      linkedField,
      childJobs
    );

    // Process all data in manageable chunks to avoid memory issues
    let currentRow = 0;
    
    // Instead of loading all batches at once, process in groups
    while (currentRow < totalRecords) {
      const batchGroup: any[][] = [];
      let currentBatch: any[] = [];
      let groupRecordCount = 0;
      const maxRecordsPerGroup = maxBatchSizeForApi * maxConcurrentBatches;
      
      console.log(`Processing records ${currentRow} to ${Math.min(currentRow + maxRecordsPerGroup, totalRecords)}`);
      
      // Build a group of batches (max 10 batches of 100 records each = 1000 records)
      for await (const record of dataStream) {
        if (!record || typeof record !== 'object') {
          console.warn(`Skipping invalid record: ${JSON.stringify(record)}`);
          continue;
        }
        
        currentBatch.push(record);
        processedRecords++;
        groupRecordCount++;
        currentRow++;

        // When a batch reaches exactly 100 records, add it to the batch group
        if (currentBatch.length >= maxBatchSizeForApi) {
          batchGroup.push([...currentBatch]);
          currentBatch = [];
        }
        
        // Once we've collected 10 full batches (or reached record limit), stop and process them
        if (groupRecordCount >= maxRecordsPerGroup || currentRow >= totalRecords) {
          break;
        }
      }
      
      // Add any remaining records as a final batch in this group
      if (currentBatch.length > 0) {
        batchGroup.push(currentBatch);
      }
      
      if (batchGroup.length === 0) {
        break; // No more records to process
      }
      
      // Prepare child table names for response processor
      const childTableNames = childJobs.map(job => job.DBTableName);
      console.log(`Processing group of ${batchGroup.length} batches with total ${groupRecordCount} records`);
      
      try {
        // Send batches in parallel (max 10 concurrently)
        const batchResults = await sendParentChildBatchesInParallel(
          batchGroup, 
          maxConcurrentBatches, // Explicitly set to 10
          jobType,
          parentTableName,
          parentScreenName,
          jobId,
          parentIdField,
          childTableNames,
          childJobs
        );
        
        // Process batch results
        const batchSuccessCount = batchResults.reduce((sum, res) => sum + (res.successCount || 0), 0);
        const batchFailureCount = batchResults.reduce((sum, res) => sum + (res.failureCount || 0), 0);
        
        // Update tracking statistics
        totalSuccessCount += batchSuccessCount;
        totalFailureCount += batchFailureCount;
        ProgressTracker.updateProgress(jobId, totalSuccessCount + totalFailureCount, totalSuccessCount, totalFailureCount);
        
        // Check for consecutive failures
        if (batchFailureCount > 0 && batchSuccessCount === 0) {
          consecutiveFailedBatches++;
          console.warn(`Batch group completely failed (${consecutiveFailedBatches}/${maxConsecutiveFailures} consecutive failures)`);
          
          if (consecutiveFailedBatches >= maxConsecutiveFailures) {
            console.error(`Stopping job after ${maxConsecutiveFailures} consecutive failed batch groups`);
            // Still add the results to the overall results
            results.push(...batchResults);
            break;
          }
        } else {
          // Reset consecutive failures counter on any success
          consecutiveFailedBatches = 0;
        }
        
        results.push(...batchResults);
        console.log(`Batch group completed: ${batchSuccessCount} successful, ${batchFailureCount} failed`);
      } catch (error) {
        // Handle batch group-level errors
        console.error(`Error processing batch group:`, error);
        consecutiveFailedBatches++;
        
        // Force database updates even when API call fails - for all batches in the group
        for (const batch of batchGroup) {
          await forceErrorRecordUpdates(batch, jobId, error);
          
          totalFailureCount += batch.length;
          ProgressTracker.updateProgress(jobId, totalSuccessCount + totalFailureCount, totalSuccessCount, totalFailureCount);
          
          results.push({
            success: false,
            successCount: 0,
            failureCount: batch.length,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        if (consecutiveFailedBatches >= maxConsecutiveFailures) {
          console.error(`Stopping job after ${maxConsecutiveFailures} consecutive failed batch groups`);
          break;
        }
      } finally {
        // IMPORTANT: Help garbage collection by clearing the batch group
        for (let i = 0; i < batchGroup.length; i++) {
          if (batchGroup[i]) {
            batchGroup[i].length = 0;
          }
        }
        batchGroup.length = 0;
        
        // Force garbage collection if available
        if (global.gc) {
          try {
            global.gc();
            console.log("Garbage collection executed");
          } catch (e) {
            console.log("Garbage collection failed", e);
          }
        }
      }
      
      // Log progress for large jobs
      if (processedRecords % 10000 === 0 || processedRecords >= totalRecords) {
        console.log(`Progress: ${processedRecords}/${totalRecords} records processed (${Math.floor(processedRecords/totalRecords*100)}%)`);
      }
    }

    // Complete the job with overall statistics
    perfMonitor.endDbFetch();
    overallPerformance.endOperation();
    const metrics = overallPerformance.getFormattedMetrics();
    
    // Log job completion once at the END
    console.log("Parent-child job completed");
    console.log(`Total records processed: ${processedRecords}`);
    console.log(`Total successful records: ${totalSuccessCount}`);
    console.log(`Total failed records: ${totalFailureCount}`);
    console.log(`Total duration: ${metrics.totalDuration}`);
    console.log(`Average time per record: ${metrics.averageTimePerRecord}`);

    ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);
    return results;
  } catch (error) {
    console.error(`Fatal error in processParentChildBatches:`, error);
    ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount + (totalRecords - processedRecords));
    
    results.push({
      success: false,
      failureCount: totalRecords - processedRecords,
      error: error instanceof Error ? error.message : String(error)
    });
    return results;
  }
}
//---------------------------------------------------------------------------
async function forceErrorRecordUpdates(records: any[], jobId: string, error: any): Promise<void> {
  try {
    console.log(`Forcing database updates for ${records.length} failed records`);
    
    // Prepare update rows for parent records
    const updateRows = records.map(record => ({
      RowId: record.__rowId || record.RowId,
      BatchId: record.__batchId,
      JobName: record.__jobType,
      Status: "Failed",
      ErrorMessage: error instanceof Error ? error.message : String(error),
      JobId: jobId,
      priority_id: null,
      is_new: 1 
    }));
    
    // Prepare error rows for logging
    const errorRows = records.map(record => ({
      JobName: record.__jobType,
      BatchId: record.__batchId,
      TableName: record.__tableName,
      RowId: record.__rowId || record.RowId,
      Error: error instanceof Error ? error.message : String(error),
      JobId: jobId
    }));
    
    // Batch update the database with error information
    // Determine table name from the first record
    const tableName = records[0]?.__tableName || "";
    
    if (tableName && updateRows.length > 0) {
      // Use the dataService functions instead of direct DatabaseService calls
      await performBulkUpdateWithService(
        tableName, 
        updateRows,
        undefined, // No performance monitor
        1000,      // Default batch size
        3          // Default retries
      );
      console.log(`Updated ${updateRows.length} parent records with error status`);
    }
    
    if (errorRows.length > 0) {
      // Use the dataService function for error logging
      await performBulkErrorInsertWithService(errorRows);
      console.log(`Logged ${errorRows.length} error records`);
    }
    
    // Add support for child records
    if (records[0]?.childRecords) {
      const childUpdatesByTable: { [tableName: string]: any[] } = {};
      
      // Process child records for each parent
      records.forEach(record => {
        if (!record.childRecords) return;
        
        Object.entries(record.childRecords).forEach(([jobType, childRecords]) => {
          if (!Array.isArray(childRecords) || childRecords.length === 0) return;
          
          // Find the table name for this job type
          const childTableName = childRecords[0]?.__tableName;
          if (!childTableName) return;
          
          // Initialize array for this table if needed
          if (!childUpdatesByTable[childTableName]) {
            childUpdatesByTable[childTableName] = [];
          }
          
          // Add each child record update
          childRecords.forEach(child => {
            childUpdatesByTable[childTableName].push({
              RowId: child.RowId,
              BatchId: record.__batchId,
              JobName: record.__jobType,
              Status: "Failed",
              ErrorMessage: error instanceof Error ? error.message : String(error),
              JobId: jobId,
              priority_id: null,
              is_new: 1
            });
          });
        });
      });
      
      // Update each child table
      for (const [tableName, updates] of Object.entries(childUpdatesByTable) as [string, any[]][]) {
        if (updates.length > 0) {
          await performBulkUpdateWithService(tableName, updates);
          console.log(`Updated ${updates.length} child records in ${tableName}`);
        }
      }
    }

    
  } catch (dbError) {
    console.error(`Failed to update database with error information:`, dbError);
  }
}


  
  //---------------------------------------------------------------------------
  // TODO: need to change it and get the batch size from PriorityJobTypes table
  // Helper function to get batch size from configuration
  async function getBatchSize(): Promise<number> {
    try {
      const result = await DatabaseService.executeQuery(
        `SELECT ConfigValue FROM PrioritySystemConfig WHERE ConfigKey = 'BATCH_SIZE'`
      );
      
      return result && result[0]
        ? parseInt((result[0] as { ConfigValue: string }).ConfigValue, 10)
        : 1000; // Default batch size
    } catch (error) {
      console.error("Error fetching batch size:", error);
      return 1000; // Default batch size if we can't get the config
    }
  }
  
//---------------------------------------------------------------------------
export { processParentChildBatches };