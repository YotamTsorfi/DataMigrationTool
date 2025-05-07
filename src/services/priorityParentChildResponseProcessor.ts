import PerformanceMonitor from "../utils/performanceMonitor";
import { writeToLogFile } from "../config/logger";
import { measureResponsePerformance } from "../services/requestSender";
import {
  performBulkUpdateWithService,
  performBulkErrorInsertWithService,
  recordBatchProcessing,
} from "../services/dataService";
//-------------------------------------------------------------------------
export interface ProcessResponseResult {
  success: boolean;
  message: string;
  successCount: number;
  failureCount: number;
  responseCount?: number;
  averageTimePerRecord: string;
  performanceMetrics: {
    dbFetchTime: string;
    dbUpdateTime: string;
    batchBuildTime: string;
    requestTime: string;
    totalDuration: string;
  };
}
//-------------------------------------------------------------------------
/**
 * עיבוד תשובה מה-API עבור מבנה אב-ילדים
 * @param response - התשובה שהתקבלה מה-API
 * @param enrichedRecords - הרשומות שנשלחו מועשרות עם מידע נוסף
 * @param perfMonitor - מנטר ביצועים
 * @param parentTable - שם טבלת האב
 * @param batchId - מזהה המנה
 * @param jobType - סוג העבודה
 * @param jobId - מזהה העבודה
 * @param priorityIdField - שדה המזהה בפריוריטי
 * @param childTableNames - שמות טבלאות הילדים
 */
export async function processParentChildResponse(
  response: any,
  enrichedRecords: any[],
  perfMonitor: PerformanceMonitor,
  parentTable: string,
  batchId: string,
  jobType: string,
  jobId: string,
  priorityIdField?: string,
  childTableNames?: string[]
): Promise<ProcessResponseResult> {
  //****   DEBUG    ****/
  // כתיבת תגובת ה-API לקובץ לוג
  const responseLogData = {
    timestamp: new Date().toISOString(),
    batchId: batchId,
    status: response?.status,
    statusText: response?.statusText,
    responseCount: response?.data?.responses?.length || 0,
    headers: response?.headers,
  };

  // שמירת מטא-דאטה של התגובה
  writeToLogFile(
    "response_debug.log",
    JSON.stringify(responseLogData, null, 2)
  );

  // שמירת גוף התגובה המלא
  writeToLogFile("response_body.log", JSON.stringify(response.data, null, 2));

  // שמירת דוגמה מהרשומות שנשלחו
  if (enrichedRecords && enrichedRecords.length > 0) {
    writeToLogFile(
      "response_record_sample.log",
      JSON.stringify(enrichedRecords[0], null, 2)
    );
  }

  //****   DEBUG    ****/
  // ------------- גרסת debugging -------------
  //   console.log('---------- DEBUG RESPONSE START ----------');
  //   console.log('Response data:', JSON.stringify(response.data, null, 2));
  //   console.log('First enriched record:', JSON.stringify(enrichedRecords[0], null, 2));
  //   console.log('---------- DEBUG RESPONSE END ----------');

  // מחזיר אובייקט תוצאה בסיסי לצורכי debugging
  return {
    success: true,
    message: "Debug only - no processing performed",
    successCount: 0,
    failureCount: 0,
    responseCount: response.data?.responses?.length || 0,
    averageTimePerRecord: "N/A",
    performanceMetrics: {
      dbFetchTime: "N/A",
      dbUpdateTime: "N/A",
      batchBuildTime: "N/A",
      requestTime: "N/A",
      totalDuration: "N/A",
    },
  };
  /*   
  try {
    // מדידת זמן התגובה
    measureResponsePerformance(response, perfMonitor);

    // עיבוד התגובה מה-API
    const {
      updateRows,
      errorRows,
      successCount,
      failureCount,
      lastProcessedIndex,
      sentToPriority,
    } = processApiResponse(response, enrichedRecords, priorityIdField);

    // עדכון מדדי ביצוע
    perfMonitor.metrics.successCount = successCount;
    perfMonitor.metrics.failureCount = failureCount;
    perfMonitor.metrics.lastProcessedIndex = lastProcessedIndex;

    // מעקב אחר כל עדכוני בסיס הנתונים
    let totalDbUpdateTime = 0;
    let batchStatus = sentToPriority ? "Completed" : "Failed";
    let hadDeadlocks = false;

    // ביצוע עדכונים מרוכזים בבסיס הנתונים לטבלת האב
    if (updateRows.length > 0) {
      try {
        // עדכון טבלת האב
        const result = await performBulkUpdateWithService(
          parentTable,
          updateRows,
          perfMonitor,
          undefined,
          3, // מספר ניסיונות חוזרים
          sentToPriority
        );

        totalDbUpdateTime += result.updateTime;
        hadDeadlocks = result.hadDeadlocks;

        // TODO: עדכון טבלאות הילדים - פיתוח עתידי
        // זהו המקום להוסיף עדכון של טבלאות הילדים בהתאם לתשובה מהשרת
        // כאן ניתן להשתמש ב-childTableNames ולבצע עדכון לכל טבלת ילד בנפרד
        if (childTableNames && childTableNames.length > 0) {
          // מקום לפיתוח עתידי - עדכון טבלאות הילדים
          console.log(`Child tables that will need updating: ${childTableNames.join(', ')}`);
          
          // דוגמה לקוד עתידי:
          // for (const childTable of childTableNames) {
          //   const childUpdateRows = prepareChildUpdateRows(response, enrichedRecords, childTable);
          //   if (childUpdateRows.length > 0) {
          //     await performBulkUpdateWithService(childTable, childUpdateRows, ...);
          //   }
          // }
        }

        if (hadDeadlocks && result.successful && sentToPriority) {
          batchStatus = "Completed";
          console.log(
            `Batch ${batchId} had deadlocks during DB update but completed successfully`
          );
        }
      } catch (dbError) {
        console.error("Error during database update:", dbError);

        const isDeadlock =
          (dbError as any)?.number === 1205 ||
          (dbError as any)?.originalError?.info?.number === 1205 ||
          (dbError instanceof Error && dbError.message.includes("deadlock"));

        if (isDeadlock && sentToPriority) {
          console.log(
            `Batch ${batchId} was sent to Priority but failed DB update due to deadlock`
          );
          batchStatus = "Completed";
        } else {
          throw dbError;
        }
      }
    }

    // רישום שגיאות בטבלת השגיאות
    if (errorRows.length > 0) {
      try {
        const errorResult = await performBulkErrorInsertWithService(
          errorRows,
          perfMonitor
        );
        totalDbUpdateTime += errorResult.updateTime;
      } catch (errorInsertError) {
        console.error("Failed to insert error logs:", errorInsertError);
      }
    }

    // וידוא שזמן העדכון נרשם
    if (totalDbUpdateTime > 0 && !perfMonitor.metrics.dbUpdateTime) {
      perfMonitor.setDbUpdateTime(totalDbUpdateTime);
    }

    perfMonitor.endOperation();
    const formattedMetrics = perfMonitor.getFormattedMetrics();

    // רישום תוצאות עיבוד המנה עם הסטטוס המתאים
    await recordBatchProcessing(
      jobType,
      batchId,
      jobId,
      new Date(perfMonitor.metrics.startTime),
      new Date(perfMonitor.metrics.endTime),
      enrichedRecords.length,
      perfMonitor.metrics.successCount,
      perfMonitor.metrics.failureCount,
      perfMonitor.metrics.lastProcessedIndex,
      batchStatus,
      hadDeadlocks
        ? "DB update had deadlocks but completed successfully"
        : null,
      parentTable
    );

    return {
      success: true,
      message: "Batch processed successfully",
      successCount: perfMonitor.metrics.successCount,
      failureCount: perfMonitor.metrics.failureCount,
      responseCount: response.data?.responses?.length || 0,
      averageTimePerRecord: formattedMetrics.averageTimePerRecord,
      performanceMetrics: {
        dbFetchTime: formattedMetrics.dbFetchTime,
        dbUpdateTime: formattedMetrics.dbUpdateTime,
        batchBuildTime: formattedMetrics.batchBuildTime,
        requestTime: formattedMetrics.requestTime,
        totalDuration: formattedMetrics.totalDuration,
      },
    };
  } catch (error) {
    console.error("Error processing parent-child response:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error in response processing",
      successCount: 0,
      failureCount: enrichedRecords.length,
      averageTimePerRecord: "N/A",
      performanceMetrics: {
        dbFetchTime: "N/A",
        dbUpdateTime: "N/A",
        batchBuildTime: "N/A",
        requestTime: "N/A",
        totalDuration: "N/A",
      },
    };
  }
  */
}

//-------------------------------------------------------------------------
/**
 * עיבוד התגובה מה-API והכנת השורות לעדכון
 * @param response - התגובה מה-API
 * @param enrichedRecords - הרשומות ששלחנו
 * @param priorityIdField - שדה המזהה בפריוריטי
 * @returns מידע מעובד על הצלחות, כישלונות ושורות לעדכון
 */
function processApiResponse(
  response: any,
  enrichedRecords: any[],
  priorityIdField?: string
) {
  // ערכי ברירת מחדל למקרה של כישלון
  const defaultErrorResult = {
    updateRows: [],
    errorRows: [],
    successCount: 0,
    failureCount: enrichedRecords.length,
    lastProcessedIndex: -1,
    sentToPriority: false,
  };

  // בדיקה אם יש תגובה תקינה
  if (!response || !response.data || !response.data.responses) {
    console.error("Invalid API response structure");
    return defaultErrorResult;
  }

  const apiResponses = response.data.responses;
  const updateRows: any[] = [];
  const errorRows: any[] = [];
  let successCount = 0;
  let failureCount = 0;
  let lastProcessedIndex = -1;

  // מעבר על כל התגובות ועיבוד כל אחת
  apiResponses.forEach((apiResponse: any, index: number) => {
    lastProcessedIndex = index;
    const record = enrichedRecords[index];

    // בדיקה אם התגובה תקינה
    if (apiResponse.status >= 200 && apiResponse.status < 300) {
      successCount++;

      // הכנת שורה לעדכון בדאטהבייס
      const updateRow: {
        RowId: any;
        Status: string;
        StatusTime: Date;
        BatchId: any;
        [key: string]: any; // מאפשר מפתחות מחרוזת נוספים
      } = {
        RowId: record.RowId, // נניח שיש לנו RowId ברשומה
        Status: "SUCCESS",
        StatusTime: new Date(),
        BatchId: record.__batchId,
      };

      // אם התגובה כוללת מזהה פריוריטי, נוסיף אותו
      if (apiResponse.body && priorityIdField) {
        try {
          const responseBody =
            typeof apiResponse.body === "string"
              ? JSON.parse(apiResponse.body)
              : apiResponse.body;

          if (responseBody && responseBody[priorityIdField]) {
            updateRow[priorityIdField] = responseBody[priorityIdField];
          }
        } catch (e) {
          console.warn(
            `Failed to parse response body JSON for record ${index}`,
            e
          );
        }
      }

      updateRows.push(updateRow);
    } else {
      // במקרה של שגיאה
      failureCount++;

      // שמירת מידע השגיאה
      let errorMessage = "Unknown error";
      try {
        if (apiResponse.body) {
          const errorBody =
            typeof apiResponse.body === "string"
              ? JSON.parse(apiResponse.body)
              : apiResponse.body;
          errorMessage =
            errorBody.error || errorBody.message || JSON.stringify(errorBody);
        }
      } catch (e) {
        errorMessage = apiResponse.body || "Failed to parse error response";
      }

      // הכנת שורה לעדכון בדאטהבייס
      updateRows.push({
        RowId: record.RowId,
        Status: "ERROR",
        StatusTime: new Date(),
        BatchId: record.__batchId,
        ErrorMessage: errorMessage,
      });

      // הוספת רשומת שגיאה מפורטת לטבלת השגיאות
      errorRows.push({
        JobId: record.__jobId,
        JobType: record.__jobType,
        EntityId: record.RowId,
        BatchId: record.__batchId,
        ErrorMessage: errorMessage,
        ErrorDetails: JSON.stringify(apiResponse),
        CreatedAt: new Date(),
        EntityData: JSON.stringify(record),
      });
    }
  });

  return {
    updateRows,
    errorRows,
    successCount,
    failureCount,
    lastProcessedIndex,
    sentToPriority: true,
  };
}
