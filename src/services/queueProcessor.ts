import axios from "axios";
import http from "http";
import https from "https";
// import { config } from "../config/config";
import { configService } from "../config/configService"; //DB
import PerformanceMonitor from "../utils/performanceMonitor";
import ProgressTracker from "../utils/progressTracker";
import { v4 as uuidv4 } from "uuid";
import { formatAxiosError } from "../utils/errorHandler";
import { recordBatchProcessing } from "./dataService";

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 4000, // הגדלה משמעותית לתמיכה ב-40 תורים × עד 100 בקשות במקביל
  keepAliveMsecs: 30000,
  timeout: 240000, // 4 דקות - חשוב למנוע "תקיעת" חיבורים
  maxFreeSockets: 1000, // שימור חיבורים פנויים לשימוש חוזר מהיר
  scheduling: "fifo", // סדר השימוש בחיבורים
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4000, // זהה לhttpAgent
  keepAliveMsecs: 30000,
  timeout: 240000,
  maxFreeSockets: 1000,
  scheduling: "fifo",
});

// Interface for queue items
export interface QueueItem {
  row: any;
  index: number;
  queueId: string;
  jobId: string;
  batchId: string;
  jobType: string;
  tableName: string;
  priorityScreenName: string;
  priorityIdField?: string;
}

// Interface for queue processor results
export interface QueueProcessorResult {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  duration: number;
}

// Interface for queue response
interface QueueItemResponse {
  success: boolean;
  status: number;
  error?: string;
  errorData?: any;
  data?: any;
  row: any;
}

/**
 * Processes a queue of items by sending them to Priority API individually
 */
export class QueueProcessor {
  private queue: QueueItem[] = [];
  private queueId: string;
  private jobId: string;
  private rateLimit: number = 10; // Default value, will be overridden in process()
  private minDelay: number = 100; // Default value, will be overridden in process()
  private performanceMonitor: PerformanceMonitor;
  private updateRows: any[] = [];
  private errorRows: any[] = [];
  private successCount = 0;
  private failureCount = 0;
  private processing = false;
  private lastProcessedIndex = 0;
  private jobType: string;
  private tableName: string;

  constructor(
    queueId: string,
    jobId: string,
    jobType: string,
    tableName: string
  ) {
    this.queueId = queueId;
    this.jobId = jobId;
    this.jobType = jobType;
    this.tableName = tableName;
    this.performanceMonitor = new PerformanceMonitor();
    this.performanceMonitor.startOperation();
  }

  // Get the number of items in the queue
  public hasItems(): boolean {
    return this.queue.length > 0;
  }
  // Add items to the queue
  public addItems(items: QueueItem[]): void {
    this.queue.push(...items);
  }
  // Get Queue ID
  public getQueueId(): string {
    return this.queueId;
  }
  // Start processing the queue
  public async process(): Promise<QueueProcessorResult> {
    if (this.processing) {
      throw new Error(`Queue ${this.queueId} is already processing`);
    }

    this.processing = true;
    const systemConfig = await configService.getConfig();
    this.rateLimit = parseInt(systemConfig.QUEUE_RATE_LIMIT || "1000", 10); // בסיס 10 - דצימלי
    this.minDelay = parseInt(systemConfig.QUEUE_MIN_DELAY || "5", 10); // בסיס 10 - דצימלי

    // Number of items to process concurrently
    const QUEUE_CONCURRENT_ITEMS = parseInt(
      systemConfig.QUEUE_CONCURRENT_ITEMS || "40",
      10
    );
    const startTime = Date.now();
    const batchId = uuidv4();

    try {
      // console.log(`Queue ${this.queueId} starting processing ${this.queue.length} items`);
      //// Explanation:
      //// - We process items in batches of CONCURRENT_ITEMS (40) to improve performance.
      //// - Each batch is processed in parallel using Promise.all.
      //// Process all items in the queue
      // for (const item of this.queue) {
      //   await this.processItem(item);

      //// Apply rate limiting
      //   await this.applyRateLimit();
      //   // Update progress tracker every few items
      //   if ((this.successCount + this.failureCount) % 10 === 0) {
      //     this.updateProgress();
      //   }
      // }

      for (let i = 0; i < this.queue.length; i += QUEUE_CONCURRENT_ITEMS) {
        const batch = this.queue.slice(i, i + QUEUE_CONCURRENT_ITEMS);

        const batchPromises = batch.map((item) => this.processItem(item));
        await Promise.all(batchPromises);

        // רק השהיה אחת בין אצוות, לא בין כל פריט
        await this.applyRateLimit();

        // עדכן progress אחרי כל אצווה
        this.updateProgress();
      }

      const endTime = Date.now();
      this.performanceMonitor.endOperation();

      // Record batch processing results
      await recordBatchProcessing(
        this.jobType,
        batchId,
        this.jobId,
        new Date(startTime),
        new Date(endTime),
        this.queue.length,
        this.successCount,
        this.failureCount,
        this.lastProcessedIndex,
        this.failureCount > 0 ? "PartialSync" : "Completed",
        null,
        this.tableName
      );

      return {
        success: true,
        totalProcessed: this.successCount + this.failureCount,
        successCount: this.successCount,
        failureCount: this.failureCount,
        duration: endTime - startTime,
      };
    } catch (error) {
      console.error(`Error processing queue ${this.queueId}:`, error);
      this.performanceMonitor.endOperation();

      return {
        success: false,
        totalProcessed: this.successCount + this.failureCount,
        successCount: this.successCount,
        failureCount: this.failureCount,
        duration: Date.now() - startTime,
      };
    } finally {
      this.processing = false;
    }
  }
  //-------------------------
  private progressListener:
    | ((successCount: number, failureCount: number) => void)
    | null = null;
  //-------------------------
  // הוספת שיטה להגדרת מאזין התקדמות
  public setProgressListener(
    listener: (successCount: number, failureCount: number) => void
  ): void {
    this.progressListener = listener;
  }
  //------------------------------------------------------
  // Process a single item in the queue
  private async processItem(item: QueueItem): Promise<void> {
    try {
      const response = await this.sendRequest(item);

      if (response.success) {
        this.successCount++;

        // Extract Priority ID from successful response using the dynamic field
        let priorityId = null;
        if (
          response.data &&
          typeof response.data === "object" &&
          item.priorityIdField
        ) {
          try {
            // If direct field is available at the top level
            if (response.data[item.priorityIdField] !== undefined) {
              const idValue = response.data[item.priorityIdField];
              priorityId =
                idValue !== null && idValue !== undefined
                  ? String(idValue)
                  : null;
            }
            // For batch responses that might have nested structure
            else if (
              response.data.body &&
              response.data.body[item.priorityIdField] !== undefined
            ) {
              const idValue = response.data.body[item.priorityIdField];
              priorityId =
                idValue !== null && idValue !== undefined
                  ? String(idValue)
                  : null;
            }
          } catch (err) {
            if (err && typeof err === "object" && "message" in err) {
              console.warn(
                `Error extracting priority_id: ${(err as any).message}`
              );
            } else {
              console.warn(`Error extracting priority_id:`, err);
            }
            priorityId = null;
          }
        }

        this.updateRows.push({
          RowId: item.row.RowId,
          BatchId: item.batchId,
          JobName: item.jobType,
          Status: "Completed",
          ErrorMessage: null,
          JobId: item.jobId,
          priority_id: priorityId,
          is_new: 0,
        });
      } else {
        this.failureCount++;
        // Update the error rows with a cleaned error message
        const cleanErrorMessage = this.formatErrorMessage(
          response.error || "",
          response.status,
          response.errorData
        );

        this.updateRows.push({
          RowId: item.row.RowId,
          BatchId: item.batchId,
          JobName: item.jobType,
          Status: "Failed",
          ErrorMessage: cleanErrorMessage,
          JobId: item.jobId,
          is_new: 1,
        });

        this.errorRows.push({
          JobName: item.jobType,
          BatchId: item.batchId,
          TableName: item.tableName,
          RowId: item.row.RowId,
          Error: cleanErrorMessage,
          JobId: item.jobId,
          ErrorStatus: response.status ? String(response.status) : null,
        });
      }

      if (this.progressListener) {
        this.progressListener(this.successCount, this.failureCount);
      }

      this.lastProcessedIndex = Math.max(
        this.lastProcessedIndex,
        item.row.RowId
      );
    } catch (error) {
      console.error(`Error processing item in queue ${this.queueId}:`, error);
      this.failureCount++;

      // Also extract errorData from caught errors
      const errorData = axios.isAxiosError(error) ? error.response?.data : null;
      const errorMessage = this.formatErrorMessage(
        error instanceof Error ? error.message : "Unknown error",
        axios.isAxiosError(error) ? error.response?.status || 0 : 0,
        errorData // Add this parameter
      );

      if (this.progressListener) {
        this.progressListener(this.successCount, this.failureCount);
      }

      this.updateRows.push({
        RowId: item.row.RowId,
        BatchId: item.batchId,
        JobName: item.jobType,
        Status: "Failed",
        ErrorMessage: errorMessage,
        JobId: item.jobId,
        is_new: 1,
      });

      this.errorRows.push({
        JobName: item.jobType,
        BatchId: item.batchId,
        TableName: item.tableName,
        RowId: item.row.RowId,
        Error: errorMessage,
        JobId: item.jobId,
        ErrorStatus: "Error",
      });
    }
  }
  //------------------------------------------------------
  // Format error message to be more user friendly
  private formatErrorMessage(
    errorMessage: string,
    status: number,
    errorData?: any
  ): string {
    // First check if we have errorData to extract detailed messages from
    if (errorData) {
      // Handle Priority's XML/FORM format (most common business validation errors)
      if (errorData.FORM?.InterfaceErrors?.text) {
        return errorData.FORM.InterfaceErrors.text;
      }

      // Handle alternative XML structure
      if (errorData["?xml"] && errorData.FORM) {
        // Handle the format exactly as shown in the example
        if (
          errorData.FORM.InterfaceErrors?.["@XmlFormat"] === "0" &&
          errorData.FORM.InterfaceErrors?.text
        ) {
          return errorData.FORM.InterfaceErrors.text;
        }

        if (typeof errorData.FORM.InterfaceErrors === "string") {
          return errorData.FORM.InterfaceErrors;
        }

        if (errorData.FORM.InterfaceErrors?.["#text"]) {
          return errorData.FORM.InterfaceErrors["#text"];
        }
      }
      // Handle common error message patterns
      if (errorData.error?.message) {
        return errorData.error.message;
      }

      if (errorData.message) {
        return errorData.message;
      }

      // Handle OData format errors
      if (errorData["odata.error"]?.message?.value) {
        return errorData["odata.error"].message.value;
      }

      // Try to find any error messages in nested objects
      if (errorData.error?.innererror?.message) {
        return errorData.error.innererror.message;
      }

      // If errorData is a simple string
      if (typeof errorData === "string") {
        return errorData;
      }

      // If it's an object, try to extract something useful
      try {
        if (typeof errorData === "object" && errorData !== null) {
          const stringified = JSON.stringify(errorData);
          if (stringified && stringified !== "{}" && stringified !== "[]") {
            return stringified;
          }
        }
      } catch (e) {
        // Ignore stringify errors and continue
      }
    }

    // Try to parse error message as JSON to extract more details
    try {
      const jsonStartIndex = errorMessage.indexOf("{");
      if (jsonStartIndex >= 0) {
        const errorJson = errorMessage.substring(jsonStartIndex);
        const errorObj = JSON.parse(errorJson);

        // Check for common error message patterns in parsed JSON
        if (errorObj.FORM?.InterfaceErrors?.text) {
          return errorObj.FORM.InterfaceErrors.text;
        }

        const detailedMessage =
          errorObj.error?.message || errorObj.message || errorObj.error || null;

        if (detailedMessage && typeof detailedMessage === "string") {
          return detailedMessage;
        }
      }
    } catch (parseError) {
      // Silent fail and continue
    }

    // Check for 409 Conflict (this is a special case worth keeping)
    if (
      status === 409 ||
      (errorMessage && errorMessage.includes("status code 409"))
    ) {
      return "Conflict: A record with the specified key already exists";
    }

    // Clean up URLs from error messages
    if (errorMessage.includes("http")) {
      const urlRegex = /(https?:\/\/[^\s)]+)/g;
      errorMessage = errorMessage.replace(urlRegex, "[API_URL]");
    }

    // Clean error message of common prefixes
    const cleanedError = errorMessage
      .replace(/ERR_BAD_REQUEST:?\s*/i, "")
      .replace(/Request failed with/i, "")
      .trim();

    return cleanedError || "Unknown error occurred";
  }
  //------------------------------------------------------
  // Send a request to the Priority API for a single item
  private async sendRequest(item: QueueItem): Promise<QueueItemResponse> {
    const maxRetries = 3;
    let retryCount = 0;
    const config = await configService.getConfig();
    const timeout = config.TIME_OUT || 180000;

    // Instead of preparing the data, we send it as is
    // just remove internal fields from the object
    const {
      RowId,
      __batchId,
      __jobType,
      __tableName,
      __jobId,
      __priorityScreenName,
      ...requestData
    } = item.row;

    while (retryCount < maxRetries) {
      try {
        // Prepare the URL for the request
        // Check if the base URL ends with a slash and the screen name starts with one
        let baseUrl = config.PRIORITY_BASE_URL;
        if (!baseUrl.endsWith("/")) baseUrl += "/";
        let company = config.PRIORITY_COMPANY;
        if (company.endsWith("/")) company = company.slice(0, -1);

        // Construct the full URL for the request
        const url = `${baseUrl}${company}/${item.priorityScreenName}`;

        const response = await axios.post(url, requestData, {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "OData-Version": "4.0",
            Authorization: `Basic ${Buffer.from(`${config.PRIORITY_PAT}:${config.PRIORITY_PASSWORD}`).toString("base64")}`,
          },
          timeout,
          httpAgent,
          httpsAgent,
        });

        return {
          success: true,
          status: response.status,
          data: response.data,
          row: item.row,
        };
      } catch (error: any) {
        retryCount++;
        const errorMessage = formatAxiosError(error);

        // Extract the full error response data
        const errorData = axios.isAxiosError(error)
          ? error.response?.data
          : null;

        // Handle rate limiting (HTTP 429)
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          const retryAfter = error.response.headers["retry-after"];
          let delayMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : 500 * Math.pow(2, retryCount);
          delayMs += Math.floor(Math.random() * 500);

          console.log(
            `Rate limit exceeded (429). Retry attempt ${retryCount} after ${delayMs}ms delay. ${errorMessage}`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Only retry on network errors and 5xx server errors
        if (
          axios.isAxiosError(error) &&
          (error.code === "ETIMEDOUT" ||
            error.code === "ECONNABORTED" ||
            error.code === "ECONNREFUSED" ||
            (error.response?.status && error.response.status >= 500))
        ) {
          const delay = 1000 * Math.pow(2, retryCount);
          console.log(
            `Retry attempt ${retryCount} after error: ${errorMessage}. Delay: ${delay}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // If the error is not a retryable error, log it and return the error response
          return {
            success: false,
            status: error.response?.status || 0,
            error: errorMessage,
            errorData: errorData, // Include the full response data
            row: item.row,
          };
        }
      }
    }

    return {
      success: false,
      status: 0,
      error: `Failed after ${maxRetries} retries`,
      row: item.row,
    };
  }
  //------------------------------------------------------
  // Apply rate limiting between requests
  private async applyRateLimit(): Promise<void> {
    const queueLength = this.queue.length;
    // אם נשארו מעט פריטים בתור או שקצב השליחה נמוך, לא צריך להמתין
    if (queueLength < 10 && this.successCount + this.failureCount < 100) {
      return; // דילוג על ההשהייה כשאין עומס
    }

    const delay = Math.max(1000 / this.rateLimit, this.minDelay);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  // private async applyRateLimit(): Promise<void> {
  //   const delay = Math.max(1000 / this.rateLimit, this.minDelay);
  //   await new Promise((resolve) => setTimeout(resolve, delay));
  // }
  //------------------------------------------------------
  // Update the progress tracker
  private updateProgress(): void {
    ProgressTracker.updateProgress(
      this.jobId,
      this.successCount + this.failureCount,
      this.successCount,
      this.failureCount
    );

    if (this.progressListener) {
      this.progressListener(this.successCount, this.failureCount);
    }
  }
  //------------------------------------------------------
  // Get result data for database updates
  public getResultData() {
    return {
      updateRows: this.updateRows,
      errorRows: this.errorRows,
      successCount: this.successCount,
      failureCount: this.failureCount,
      lastProcessedIndex: this.lastProcessedIndex,
    };
  }
}
