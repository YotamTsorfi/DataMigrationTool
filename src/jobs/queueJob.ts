import { v4 as uuidv4 } from "uuid";
import { fetchDataChunk } from "../services/dataService";
import { configService } from "../config/configService";
import PerformanceMonitor from "../utils/performanceMonitor";
import ProgressTracker from "../utils/progressTracker";
import { QueueProcessor, QueueItem } from "../services/queueProcessor";
import { performBulkUpdateWithService, performBulkErrorInsertWithService } from "../services/dataService";
import { DatabaseService } from "../services/databaseService";

/**
 * Process records using parallel queues
 */
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
  // Get system configuration
  const config = await configService.getConfig();
  const HORIZONTAL_BATCH_SIZE = parseInt(config.HORIZONTAL_BATCH_SIZE || "10", 10);  // מספר התהליכים המקביליים
  const VERTICAL_BATCH_SIZE = parseInt(config.VERTICAL_BATCH_SIZE || "5", 10);       // מספר הרשומות הסדרתיות בכל תהליך
  const CHUNK_SIZE = 1000;
  
  // Initialize progress tracking for this job
  ProgressTracker.initJob(jobId, recordCount);
  
  // Process in chunks
  let processedCount = 0;
  let lastRowId = startRow - 1;
  const results = [];
  let totalSuccessCount = 0;
  let totalFailureCount = 0;
  
  while (processedCount < recordCount) {
    const chunkSize = Math.min(CHUNK_SIZE, recordCount - processedCount);
    
    // Fetch data chunk from database
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.startDbFetch();
    const rows = await fetchDataChunk(tableName, lastRowId, chunkSize);
    perfMonitor.endDbFetch();
    
    if (rows.length === 0) break;

    // עיבוד במבנה Grid: חלוקה לקבוצות אופקיות ואנכיות
    for (let i = 0; i < rows.length; i += HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE) {
      const horizontalBatch = rows.slice(i, i + HORIZONTAL_BATCH_SIZE * VERTICAL_BATCH_SIZE);
      
      // יצירת מעבדי תורים לפי מספר האצוות האופקיות
      const horizontalQueues: QueueProcessor[] = [];
      for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
        horizontalQueues.push(new QueueProcessor(`queue-${h}`, jobId, jobType, tableName));
      }

      // חלוקת הנתונים לאצוות אופקיות
      for (let h = 0; h < HORIZONTAL_BATCH_SIZE; h++) {
        const startIndex = h * VERTICAL_BATCH_SIZE;
        const verticalBatch = horizontalBatch.slice(startIndex, startIndex + VERTICAL_BATCH_SIZE);
        
        if (verticalBatch.length === 0) continue;
        
        // הוספת כל הרשומות מהאצווה האנכית לתור המתאים
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
            priorityScreenName
          };
        });
        
        horizontalQueues[h].addItems(queueItems);
      }
      
      // עיבוד כל התורים במקביל - כל תור מעבד את האצווה האנכית שלו בטור (סדרתי)
      const queuePromises = horizontalQueues
        .filter(q => q.hasItems()) // רק תורים עם פריטים
        .map(queue => queue.process());
      
      const queueResults = await Promise.all(queuePromises);
      
      // איסוף התוצאות
      for (let qIndex = 0; qIndex < queueResults.length; qIndex++) {
        const result = queueResults[qIndex];
        results.push(result);
        totalSuccessCount += result.successCount;
        totalFailureCount += result.failureCount;
        
        // קבלת נתוני התוצאה לעדכונים במסד הנתונים
        const resultData = horizontalQueues[qIndex].getResultData();
        
        // עדכון מסד הנתונים עם התוצאות
        await processQueueResults(resultData, tableName);
      }
      
      // עדכון מעקב התקדמות
      ProgressTracker.updateProgress(
        jobId,
        totalSuccessCount + totalFailureCount,
        totalSuccessCount,
        totalFailureCount
      );
    }
    
    // עדכון המזהה האחרון לחלק הבא
    lastRowId = (rows[rows.length - 1] as { RowId: number }).RowId;
    processedCount += rows.length;
  }
  
  // סימון העבודה כהושלמה
  ProgressTracker.completeJob(jobId, totalSuccessCount, totalFailureCount);
  
  // החזרת תוצאות קלות-משקל
  return results.map(result => ({
    success: result.success,
    totalProcessed: result.totalProcessed,
    successCount: result.successCount,
    failureCount: result.failureCount,
    duration: result.duration
  }));
}

/**
 * Process queue results by updating the database
 */
async function processQueueResults(
  resultData: { 
    updateRows: any[],
    errorRows: any[],
    successCount: number,
    failureCount: number,
    lastProcessedIndex: number
  },
  tableName: string
): Promise<void> {
  const perfMonitor = new PerformanceMonitor();
  perfMonitor.startOperation();
  
  try {
    // הוסף בדיקה לוודא שכל השדות המינימליים קיימים
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
    const errorColumn = availableColumns.has('ErrorMessage') ? 'ErrorMessage' : 
                       (availableColumns.has('Error') ? 'Error' : null);

    if (!errorColumn) {
      console.warn(`No error column found in table ${tableName}, error details may be lost`);
    }

    // For update rows, process possible error message truncation
    resultData.updateRows.forEach(row => {
      // Truncate error messages if necessary
      if (row.ErrorMessage && row.ErrorMessage.length > 3800) {
        row.ErrorMessage = row.ErrorMessage.substring(0, 3800);
      }
    });
    
    // Update rows with results - העבר גם פרמטר שמציין שזה נשלח ל-Priority
    await performBulkUpdateWithService(
      tableName,
      resultData.updateRows,
      perfMonitor,
      1000,  // בגודל ברירת המחדל
      3,     // 3 ניסיונות חוזרים
      true   // סמן ששורות אלו נשלחו לפריוריטי
    );
    
    // console.log(`Successfully updated ${resultData.updateRows.length} rows in ${tableName}`);
  } catch (error) {
    console.error(`Error updating rows in ${tableName}:`, error);
    
    // אם הבאלק אפדייט נכשל, ננסה לעדכן כל שורה בנפרד
    console.log(`Trying to update rows individually`);
    for (const row of resultData.updateRows) {
      try {
        // Check if Error column exists in table
        const errorColumnQuery = `
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = '${tableName}' 
          AND COLUMN_NAME IN ('ErrorMessage', 'Error')
        `;
        const errorColumns = await DatabaseService.executeQuery(errorColumnQuery) as { COLUMN_NAME: string }[];
        const errorColumn = errorColumns.length > 0 ? errorColumns[0].COLUMN_NAME : null;
        
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
          RowId: row.RowId
        };
        
        if (errorColumn) {
          // Truncate error message if needed
          const errorValue = row.ErrorMessage || row.Error || null;
          params.ErrorValue = errorValue && errorValue.length > 3800 ? 
                              errorValue.substring(0, 3800) : 
                              errorValue;
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