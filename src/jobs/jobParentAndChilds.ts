import { DatabaseService } from "../services/databaseService";
import { streamParentChildData } from '../services/parentChildDataFetcher';
import { sendParentChildBatchesInParallel } from '../services/priorityParentChildSender';
import ProgressTracker from "../utils/progressTracker";
import PerformanceMonitor from "../utils/performanceMonitor";
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
    // Log parent job details for better visibility
    console.log("------------- DEBUG --------------------");
    console.log("Parent job details:");
    console.log(`  Table Name: ${parentTableName}`);
    console.log(`  Screen Name: ${parentScreenName}`);
    console.log(`  Parent ID Field: ${parentIdField}`);
    console.log(`  Linked Field: ${linkedField}`);
    console.log(`  Job Type: ${jobType}`);
    console.log("------------");
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
    console.log("---------------END DEBUG ---------------------");
    
    // אתחול מעקב התקדמות למשימה
    ProgressTracker.initJob(jobId, totalRecords);

    // יצירת מוניטור ביצועים כולל למשימה
    const overallPerformance = new PerformanceMonitor();
    overallPerformance.startOperation();

    const results: BatchResult[] = [];
    const batchSize = await getBatchSize();
    let processedRecords = 0;
    let totalSuccessCount = 0;
    let totalFailureCount = 0;
    const maxBatchSizeForApi = 1000;
    const totalBatches = Math.ceil(totalRecords / batchSize);
    startRow = 0;

    try {
      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
          const offset = startRow + batchNum * batchSize;
          // console.log(
          //   `Processing batch ${batchNum + 1}/${totalBatches}, offset: ${offset}`
          // );
          // מדידת זמן שליפת נתונים
          const perfMonitor = new PerformanceMonitor();
          perfMonitor.startDbFetch();
          
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

          //----
          // עיבוד הנתונים בזמן אמת כשהם זורמים מהדאטה בייס
          const batches: any[][] = [];
          let currentBatch: any[] = [];

          for await (const record of dataStream) {
            currentBatch.push(record);
            processedRecords++;

            // כשמגיעים לגודל המקסימלי, שומרים את המנה ומתחילים חדשה
            if (currentBatch.length >= maxBatchSizeForApi) {
              batches.push([...currentBatch]);
              currentBatch = [];
            }
          }
          
          // סיום מדידת זמן שליפת נתונים
          perfMonitor.endDbFetch();
          // console.log(`Fetched ${processedRecords} records in ${perfMonitor.getFormattedMetrics().dbFetchTime}`);

          // הוספת המנה האחרונה אם יש בה נתונים
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
          }

          // הכנת רשימת טבלאות הילדים לצורך עדכון במעבד התגובות
          const childTableNames = childJobs.map(job => job.DBTableName);

          // שליחת כל המנות במקביל עם מקבוליות של 10
          if (batches.length > 0) {
            // console.log(`Sending ${batches.length} batches with total ${processedRecords} records to Priority API`);

            // מדידת זמן שליחה
            perfMonitor.startRequest();

            const batchResults = await sendParentChildBatchesInParallel(
              batches,
              10, // מספר השליחות המקביל
              jobType,
              parentTableName,
              parentScreenName,
              jobId,
              parentIdField,
              childTableNames,
              childJobs              
            );

            // סיום מדידת זמן שליחה
            perfMonitor.endRequest();

            // עיבוד תוצאות הריצה
            const batchSuccessCount = batchResults.reduce((sum, res) => sum + (res.successCount || 0), 0);
            const batchFailureCount = batchResults.reduce((sum, res) => sum + (res.failureCount || 0), 0);
            
            // צבירת סטטיסטיקה מצטברת
            totalSuccessCount += batchSuccessCount;
            totalFailureCount += batchFailureCount;

            // עדכון מעקב התקדמות
            ProgressTracker.updateProgress(
            jobId,
            processedRecords,
            totalSuccessCount,
            totalFailureCount
          );

            // הוספת התוצאות למערך התוצאות הכולל
            results.push(...batchResults);     
            
            // console.log(`Batch ${batchNum + 1} completed: ${batchSuccessCount} successful, ${batchFailureCount} failed out of ${processedRecords} records`);
            // console.log(`Total progress: ${processedRecords}/${totalRecords} records processed (${totalSuccessCount} successful, ${totalFailureCount} failed)`);            

          }
      
            // סיום וסיכום המשימה
            overallPerformance.endOperation();
            const metrics = overallPerformance.getFormattedMetrics();
            
            console.log("Job completed successfully");
            console.log(`Total records processed: ${processedRecords}`);
            console.log(`Total successful records: ${totalSuccessCount}`);
            console.log(`Total failed records: ${totalFailureCount}`);
            console.log(`Total duration: ${metrics.totalDuration}`);
            console.log(`Average time per record: ${metrics.averageTimePerRecord}`);


        // DEBUG: Log the data stream to a file for inspection
        // for await (const record of dataStream) {
        //   writeToLogFile(
        //     "parentChildData.log",
        //     `${JSON.stringify(record)}`
        //   );
        //   //break; // אפשר לעצור אחרי רשומה אחת לצורך בדיקה
        // }   
      }

      // סימון המשימה כהושלמה
      ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);

      return results;
    } catch (error) {
      console.error(`Error in processParentChildBatches: ${error}`);

      // עדכון ProgressTracker במקרה של שגיאה
      ProgressTracker.updateProgress(
        jobId, 
        processedRecords,
        totalSuccessCount,
        totalFailureCount + (totalRecords - processedRecords)
      );
      
      // סימון המשימה כהושלמה עם שגיאות
      ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount + (totalRecords - processedRecords));

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