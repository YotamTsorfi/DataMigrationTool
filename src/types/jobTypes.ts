export interface BatchCreateRowsResult {
  success: boolean;
  message?: string;
  rowsCount?: number;
  data?: any;
  requestSize?: number;
  responseSize?: number;
  duration?: number;
  averageTimePerRecord?: string;
  error?: string;
  details?: string;
}

export interface JobProgress {
  jobId: string;
  totalRecords: number;
  processedRecords: number;
  successCount: number;
  failureCount: number;
  percentage: number;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface ProcessedApiResponse {
  updateRows: any[];
  errorRows: any[];
  successCount: number;
  failureCount: number;
  lastProcessedIndex: number;
}

export interface EnrichedRow extends Record<string, any> {
  RowId: number;
  __batchId: string;
  __jobType: string;
  __tableName: string;
  __jobId: string;
  __priorityScreenName: string;
}

export interface SystemConfig {
  BATCH_SIZE: number;
  CONCURRENT_BATCHES: number;
  DELAY_BETWEEN_BATCHES: number;
  MIN_DELAY?: number;
  MAX_DELAY?: number;
  [key: string]: any;
}
