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
  keepAlive: true, // Enable connection pooling
  keepAliveMsecs: 30000, // Keep connections alive
  maxSockets: 1000,
  timeout: 240000,
});

const httpsAgent = new https.Agent({
  keepAlive: true, // Enable connection pooling
  keepAliveMsecs: 30000, // Keep connections alive
  maxSockets: 1000,
  timeout: 240000,
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
  priorityScreenName?: string;
  priorityIdField?: string;
  childJobs?: any[];
  childTableNames?: string[];
}

// Interface for queue processor results
export interface QueueProcessorResult {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  duration: number;
}

export type ItemProcessorFunction = (item: QueueItem) => Promise<{
  success: boolean;
  error?: any;
  responseStats?: {
    successCount: number;
    failureCount: number;
    priorityId?: string | null;
    status?: number;
    errorData?: any;
  };
}>;

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
  private consecutiveSuccesses = 0;
  private backoffActive = false;
  private normalConcurrency: number = 100;
  private totalRequests = 0;
  private total503Errors = 0;
  private concurrencyLimit = 100; // default
  private errorCount503 = 0;
  private lastErrorTimeStamp = 0;
  private logRetries: boolean = false;
  private enableRateLimit: boolean = true; // Enable rate limiting by default
  private startTime: number | null = null;

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

  private itemProcessor: ItemProcessorFunction | null = null;

  /**
   * Set custom item processor function
   */
  public setItemProcessor(processor: ItemProcessorFunction): void {
    this.itemProcessor = processor;
  }

  public setRateLimitEnabled(enabled: boolean): void {
    this.enableRateLimit = enabled;
    console.log(
      `Queue ${this.queueId}: Rate limiting ${enabled ? "enabled" : "disabled"}`
    );
  }
  public addItem(item: QueueItem): void {
    this.queue.push(item);
  }

  // Set custom concurrency for this queue

  public setConcurrency(limit: number): void {
    this.concurrencyLimit = limit;
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
    this.errorCount503 = 0; // Reset error count for each new processing
    const systemConfig = await configService.getConfig();
    this.rateLimit = parseInt(systemConfig.QUEUE_RATE_LIMIT || "1000", 10); // בסיס 10 - דצימלי
    this.minDelay = parseInt(systemConfig.QUEUE_MIN_DELAY || "30", 10); // בסיס 10 - דצימלי

    // Store normal concurrency value
    const configConcurrency = parseInt(
      systemConfig.QUEUE_CONCURRENT_ITEMS || "500",
      10
    );
    this.normalConcurrency = this.concurrencyLimit || configConcurrency;

    const QUEUE_CONCURRENT_ITEMS = this.backoffActive
      ? Math.floor(this.normalConcurrency * 0.7)
      : this.normalConcurrency;

    // Number of items to process concurrently
    // const QUEUE_CONCURRENT_ITEMS =
    //   this.concurrencyLimit ||
    //   parseInt(systemConfig.QUEUE_CONCURRENT_ITEMS || "500", 10);
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
        // Only apply rate limiting if enabled
        if (this.enableRateLimit) {
          await this.applyRateLimit();
        }

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
      console.log(
        `Queue ${this.queueId} stats: ${this.total503Errors}/${this.totalRequests} requests resulted in 503 errors (${((this.total503Errors / this.totalRequests) * 100).toFixed(2)}%)`
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
      // Track when processing started
      const itemStartTime = Date.now();
      this.startTime = this.startTime || itemStartTime;

      // Use custom processor if provided (for parent-child relationships)
      if (this.itemProcessor) {
        const result = await this.itemProcessor(item);

        if (result.success) {
          this.successCount += result.responseStats?.successCount || 1;

          // If we have priority ID information, add it to update rows
          let priorityId = null;
          if (result.responseStats?.priorityId) {
            priorityId = result.responseStats.priorityId;
          }

          // Add success row
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
          this.failureCount += result.responseStats?.failureCount || 1;

          // Format error message
          const cleanErrorMessage = this.formatErrorMessage(
            result.error || "Unknown error",
            typeof result.responseStats?.status === "number"
              ? result.responseStats.status
              : 0,
            result.responseStats?.errorData
          );

          // Add failure row
          this.updateRows.push({
            RowId: item.row.RowId,
            BatchId: item.batchId,
            JobName: item.jobType,
            Status: "Failed",
            ErrorMessage: cleanErrorMessage,
            Error: cleanErrorMessage,
            JobId: item.jobId,
            priority_id: null,
            is_new: 1,
          });

          // Add error row
          this.errorRows.push({
            JobName: item.jobType,
            BatchId: item.batchId,
            TableName: item.tableName,
            RowId: item.row.RowId,
            Error: cleanErrorMessage,
            JobId: item.jobId,
            ErrorStatus: result.responseStats?.status
              ? String(result.responseStats.status)
              : null,
          });
        }
      }
      // Standard process for parent-only items
      else {
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
            Error: cleanErrorMessage,
            JobId: item.jobId,
            priority_id: null,
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
      }

      // Update tracking for progress
      this.lastProcessedIndex = Math.max(
        this.lastProcessedIndex,
        item.row.RowId
      );

      // Update progress
      if (this.progressListener) {
        this.progressListener(this.successCount, this.failureCount);
      }
    } catch (error) {
      console.error(`Error processing item in queue ${this.queueId}:`, error);
      this.failureCount++;

      // Also extract errorData from caught errors
      const errorData = axios.isAxiosError(error) ? error.response?.data : null;
      const errorMessage = this.formatErrorMessage(
        error instanceof Error ? error.message : "Unknown error",
        axios.isAxiosError(error) ? error.response?.status || 0 : 0,
        errorData
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
        priority_id: null,
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
  /*
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
          priority_id: null,
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
        priority_id: null,
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
  */
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
    // const requestStartTime = Date.now();
    // console.log(
    //   `[${this.queueId}] Starting request #${this.successCount + this.failureCount + 1}`
    // );

    const maxRetries = 3;
    let retryCount = 0;
    const config = await configService.getConfig();
    const timeout = config.TIME_OUT || 240000;

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

        // console.log(
        //   `[${this.queueId}] Completed request in ${Date.now() - requestStartTime}ms`
        // );
        this.totalRequests++;
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

        // Handle service unavailable (HTTP 503)
        // If the error is a 503, we will retry with exponential backoff
        if (axios.isAxiosError(error) && error.response?.status === 503) {
          this.total503Errors++;
          this.totalRequests++;
          this.errorCount503++;
          this.lastErrorTimeStamp = Date.now();

          const retryAfter = error.response.headers["retry-after"];
          let delayMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : 1000 * Math.pow(2, retryCount);
          delayMs += Math.floor(Math.random() * 500);

          // Only log if we're in verbose mode
          if (this.logRetries) {
            console.log(
              `Service unavailable (503). Retry attempt ${retryCount} after ${delayMs}ms delay. ${errorMessage}`
            );
          }

          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        // Handle rate limiting (HTTP 429)
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          const retryAfter = error.response.headers["retry-after"];
          let delayMs = retryAfter
            ? parseInt(retryAfter) * 1000
            : 500 * Math.pow(2, retryCount);
          delayMs += Math.floor(Math.random() * 500);

          if (this.logRetries) {
            console.log(
              `Rate limit exceeded (429). Retry attempt ${retryCount} after ${delayMs}ms delay. ${errorMessage}`
            );
          }
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
          if (this.logRetries) {
            console.log(
              `Retry attempt ${retryCount} after error: ${errorMessage}. Delay: ${delay}ms`
            );
          }
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
    console.log(
      `Queue ${this.queueId}: queue.length=${this.queue.length}, errorCount503=${this.errorCount503}, backoffActive=${this.backoffActive}`
    );

    // REDUCED THRESHOLD: Apply rate limiting to smaller batches too
    if (this.queue.length < 300) {
      return; // Only skip very small batches
    }

    const recentErrors = Date.now() - this.lastErrorTimeStamp < 10000;

    // Track consecutive successes to recover from backoff
    if (!recentErrors) {
      this.consecutiveSuccesses++;

      if (this.backoffActive && this.consecutiveSuccesses > 200) {
        console.log(
          "Exiting backoff mode after consecutive successful requests"
        );
        this.backoffActive = false;
        this.errorCount503 = 0;
      }
    } else {
      this.consecutiveSuccesses = 0;

      // REDUCED THRESHOLD: Enter backoff sooner
      if (this.errorCount503 > 2 && !this.backoffActive) {
        console.log("Entering backoff mode due to multiple 503 errors");
        this.backoffActive = true;
      }
    }

    // Gentler adaptive delay based on error rate
    let delay = Math.max(2, Math.min(this.minDelay, 5));

    if (recentErrors && this.errorCount503 > 0) {
      // More moderate scaling formula
      delay = Math.min(100, 3 * Math.log(this.errorCount503 + 1) * 3);
      console.log(
        `Applying adaptive throttling delay: ${delay}ms due to 503 errors`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  // private async applyRateLimit(): Promise<void> {
  //   // Skip rate limiting for small batches
  //   if (this.queue.length < 1000) {
  //     return; // No delay for small queues
  //   }

  //   // Use a much smaller delay for large queues
  //   const delay = Math.max(5, Math.min(this.minDelay, 5));
  //   await new Promise((resolve) => setTimeout(resolve, delay));
  // }
  // private async applyRateLimit(): Promise<void> {
  //   const queueLength = this.queue.length;
  //   // אם נשארו מעט פריטים בתור או שקצב השליחה נמוך, לא צריך להמתין
  //   if (queueLength < 10 && this.successCount + this.failureCount < 100) {
  //     return; // דילוג על ההשהייה כשאין עומס
  //   }

  //   const delay = Math.max(1000 / this.rateLimit, this.minDelay);
  //   await new Promise((resolve) => setTimeout(resolve, delay));
  // }
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
