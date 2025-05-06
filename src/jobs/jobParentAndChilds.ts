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
    startRow = 0;

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
            `${JSON.stringify(record)}`
          );
          //break; // אפשר לעצור אחרי רשומה אחת לצורך בדיקה
        }
    /*
        let currentBatch: any[] = [];

      // Send the combined data to Priority
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
        // Process the data in batches of 1000 records (or whatever is set in the system config / or at the parent job**) and combine the rows by the requirements.
        // Send the rows to Priority using the batch API
        // Process the response and update the database entities accordingly
        //  Process the response and update database entities        
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
  
//---------------------------------------------------------------------------
export { processParentChildBatches };