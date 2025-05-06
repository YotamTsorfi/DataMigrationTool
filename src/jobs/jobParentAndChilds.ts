import { config } from "../config/config";
import { DatabaseService } from "../services/databaseService";
import { configService } from "../config/configService";
import ProgressTracker from "../utils/progressTracker";
import PerformanceMonitor from "../utils/performanceMonitor";
import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";
import {
  fetchDataChunk,
  performBulkUpdateWithService,
  performBulkErrorInsertWithService,
  recordBatchProcessing,
} from "../services/dataService";
import {
  buildBatchRequestBody,
  createBatchHeaders,
  generateBoundary,
} from "../services/requestBuilder";
import {
  sendBatchRequest,
  processApiResponse,
  measureRequestPerformance,
  measureResponsePerformance,
} from "../services/requestSender";


import { streamParentChildData } from '../services/parentChildDataFetcher';
import { writeToLogFile } from "../config/logger";
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
    // Log parent job details for better visibility
    console.log("Parent job details:");
    console.log(`  Table Name: ${parentTableName}`);
    console.log(`  Screen Name: ${parentScreenName}`);
    console.log(`  Parent ID Field: ${parentIdField}`);
    console.log(`  Linked Field: ${linkedField}`);
    console.log(`  Job Type: ${jobType}`);
    // console.log(`Starting processParentChildBatches for job ${jobId}`);

    console.log(`Processing ${childJobs.length} child jobs`);

    const results: BatchResult[] = [];
    const batchSize = await getBatchSize();
    let processedRecords = 0;
    const maxBatchSizeForApi = 1000;
    const totalBatches = Math.ceil(totalRecords / batchSize);

    try {
      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
          const offset = startRow + batchNum * batchSize;
          console.log(
            `Processing batch ${batchNum + 1}/${totalBatches}, offset: ${offset}`
          );

          // Log childJobs for inspection
          console.log("Child jobs details:");
          childJobs.forEach((job, index) => {
            console.log(`Child job ${index + 1}:`);
            console.log(`  JobType: ${job.JobTypeName}`);
            console.log(`  TableName: ${job.DBTableName}`);
            console.log(`  ScreenName: ${job.ScreenName}`);
            console.log(`  Priority ID: ${job.priority_id}`);
            console.log(`  HasSiblings: ${job.HasSiblings}`);
          });
      
        const dataStream = streamParentChildData(
          parentTableName,
          batchSize,
          startRow,
          totalRecords,
          parentIdField,
          linkedField,
          parentScreenName,
          childJobs
        );

        // אפילו בדיקה פשוטה זו תספיק כדי להפעיל את הגנרטור
        // והיא תאפשר לך לראות את הלוגים
        for await (const record of dataStream) {
          writeToLogFile(
            "parentChildData.log",
            `[INFO] Record data: ${JSON.stringify(record)}`
          );
          //break; // אפשר לעצור אחרי רשומה אחת לצורך בדיקה
        }
    /*
        let currentBatch: any[] = [];

      // עיבוד הנתונים בזמן אמת כשהם זורמים מהדאטה בייס
      for await (const record of dataStream) {
        currentBatch.push(record);
        processedRecords++;
      
        // כשמגיעים לגודל המקסימלי, שולחים את המנה לשרת
        // TODO: move sendToPriority to separate file and import it here
        if (currentBatch.length >= maxBatchSizeForApi) {
          const batchResult = await sendToPriority(currentBatch);
          results.push(batchResult);
          
          // עדכון התקדמות
          // ProgressTracker.updateProgress(jobId, currentBatch.length, 
          //   batchResult.success ? currentBatch.length : 0);
          
          // איפוס המנה הנוכחית
          currentBatch = [];
        }
      }

        // שליחת מנה אחרונה אם נשארו רשומות
        if (currentBatch.length > 0) {
          const batchResult = await sendToPriority(currentBatch);
          results.push(batchResult);
          // ProgressTracker.updateProgress(jobId, currentBatch.length, 
          //   batchResult.success ? currentBatch.length : 0);
        }
    
      */
        // Example of how to fetch parent records for this batch
        //const parentRecords = await fetchParentRecords(parentTableName, offset, batchSize, parentIdField);
        // Create new file for Fetching data from both parent and child entities
        // Process the data in batches of 1000 records (or whatever is set in the system config / or at the parent job**) and combine the rows by the requirements.
        // Send the rows to Priority using the batch API
        // Process the response and update the database entities accordingly

        //console.log(`Fetched ${parentRecords.length} parent records`);
        // 1. Fetch parent records for this batch
        //const parentRecords = await fetchParentRecords(parentTableName, offset, batchSize, parentIdField);

        // 2. For each parent record, fetch the related child records
        //const combinedData = await combineParentChildData(parentRecords, parentIdField, linkedField, childJobs);

        // 3. Send the combined data to Priority
        //const batchResult = await sendToPriority(combinedData, parentScreenName);

        // 4. Process the response and update database entities
        //await processBatchResponse(batchResult, parentTableName, childJobs);

        // 5. Update progress
        // ProgressTracker.updateProgress(jobId, batchSize, batchResult.success ? batchSize : 0);

        // 6. Add result to results array
        // results.push({
        //   success: batchResult.success,
        //   successCount: batchResult.success ? batchSize : 0,
        //   failureCount: batchResult.success ? 0 : batchSize,
        //   error: batchResult.success ? undefined : batchResult.error
        // });
      }

      return results;
    } catch (error) {
      console.error(`Error in processParentChildBatches: ${error}`);
      results.push({
        success: false,
        failureCount: totalRecords - processedRecords,
        error: error,
      });
      return results;
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
  
  // Helper function to fetch parent records
  async function fetchParentRecords(tableName: string, offset: number, limit: number, idField: string): Promise<any[]> {
    const query = `SELECT * FROM ${tableName} ORDER BY ${idField} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    return await DatabaseService.executeQuery(query);
  }
  //---------------------------------------------------------------------------
  // Helper function to combine parent and child data
  async function combineParentChildData(
    parentRecords: any[],
    parentIdField: string,
    linkedField: string,
    childJobs: ChildJob[]
  ): Promise<any[]> {
    const combinedData = [];
    
    for (const parent of parentRecords) {
      const parentId = parent[parentIdField];
      const linkedValue = parent[linkedField];
      
      // Create base record from parent
      const record = { ...parent, children: {} };
      
      // For each child job type, fetch related records
      for (const childJob of childJobs) {
        const childRecords = await DatabaseService.executeQuery(
          `SELECT * FROM ${childJob.DBTableName} WHERE ${childJob.priority_id} = @LinkedValue`,
          { LinkedValue: linkedValue }
        );
        
        // Add child records to parent record
        record.children[childJob.JobTypeName] = childRecords;
      }
      
      combinedData.push(record);
    }
    
    return combinedData;
  }
  //---------------------------------------------------------------------------
  // Helper function to process batch response and update database
  async function processBatchResponse(batchResult: any, parentTableName: string, childJobs: ChildJob[]): Promise<void> {
    // Implementation depends on the response structure and update requirements
    // This would update both parent and child tables based on the Priority response
    console.log(`Processing batch response for ${parentTableName}`);
  }
  //---------------------------------------------------------------------------
  // פונקציית עזר לשליחת נתונים לשירות Priority
  async function sendToPriority(records: any[]): Promise<BatchResult> {
    try {
      // יצירת גוף הבקשה
      // const boundary = generateBoundary();
      // const requestBody = buildBatchRequestBody(records, boundary);
      // const headers = createBatchHeaders(boundary);
      
      // // שליחת הבקשה ועיבוד התשובה
      // const response = await sendBatchRequest(requestBody, headers);
      // const result = await processApiResponse(response);
      
      // return {
      //   success: result.success,
      //   successCount: result.successCount || 0,
      //   failureCount: result.failureCount || 0,
      //   error: result.error
      // };

      //TODO Delete after debugging
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        error: "error"
      };
    } catch (error) {
      console.error(`Error sending batch to Priority: ${error}`);
      return {
        success: false,
        failureCount: records.length,
        error
      };
    }
  }
//---------------------------------------------------------------------------


export { processParentChildBatches };