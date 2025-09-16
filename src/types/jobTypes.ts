export interface DeltaMetadata {
  is_new: number;
  is_modified: number;
  priority_id: string | null;
  reference_id: string | null;
  parent_priority_id?: string | null;
}

// Enhanced queue item with delta metadata
export interface DeltaQueueItem extends QueueItem {
  isDelta: boolean;
  deltaMetadata?: DeltaMetadata;
}

export interface ParentRecord {
  RowId: number;
  Data: string;
  [key: string]: any;
}
export interface ChildRecord {
  RowId: number;
  Data: string;
  [key: string]: any;
}

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
export interface QueueItemResponse {
  success: boolean;
  status: number;
  error?: string;
  errorData?: any;
  data?: any;
  row: any;
}

export type JobStatus =
  | "Queued"
  | "Running"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "Cancelling";
export interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
  jobType: string;
  processingType?: string;
  priorityIdField: string;
  priorityLinkedField?: string;
  priorityJobTypeId?: number;
  logErrors?: boolean;
  updateBatchTable?: boolean;
  processAllRecords?: boolean;
  caseId?: string;
}

export interface ChildJob {
  ChildJobeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string;
  HasSiblings: boolean;
}

export interface JobResult {
  successCount?: number;
  failureCount?: number;
  success?: boolean;
}

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

export interface BatchResult {
  success: boolean;
  successCount?: number;
  failureCount?: number;
  error?: any;
  rowsCount?: number;
  duration?: number;
  totalProcessed?: number;
}

export interface BatchCreateRowsResult {
  success: boolean;
  message?: string;
  rowsCount?: number;
  responseStats?: any;
  requestSize?: number;
  responseSize?: number;
  duration?: number;
  averageTimePerRecord?: string;
  error?: string;
  details?: string;
  performanceMetrics?: {
    dbFetchTime?: string;
    dbUpdateTime?: string;
    batchBuildTime?: string;
    requestTime?: string;
    totalDuration?: string;
  };
  [key: string]: any; // Add index signature to allow arbitrary string keys
}

export interface BatchSendResult {
  success: boolean;
  batchId: string;
  message?: string;
  rowsCount: number;
  successCount: number;
  failureCount: number;
  responseCount?: number;
  error?: any;
  duration?: number;
  averageTimePerRecord?: string;
  performanceMetrics?: {
    dbFetchTime: string;
    dbUpdateTime: string;
    batchBuildTime: string;
    requestTime: string;
    totalDuration: string;
  };
}

export interface ParentChildQueueResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  error?: string;
  status?: number;
  errorData?: any;
  priorityId?: string | null;
  duration?: number;
}

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

export interface JobNotificationDetails {
  jobId: string;
  jobType: string;
  tableName: string;
  screenName: string;
  totalRecords: number;
  progressPercent?: number;
  successCount?: number;
  failureCount?: number;
  duration?: string;
  status?: string;
}

export interface PerformanceMetrics {
  startTime: number;
  endTime: number;
  duration: number;
  requestSize: number;
  responseSize: number;
  success: boolean;
  statusCode?: number;
  errorType?: string;
  recordCount: number;
  averageTimePerRecord?: string;
  successCount: number;
  failureCount: number;
  lastProcessedIndex: number;
  dbFetchTime?: number;
  dbUpdateTime?: number;
  batchBuildTime?: number;
  requestTime?: number;
}

export interface JobProgress {
  jobId: string;
  jobName?: string;
  totalRecords: number;
  processedRecords: number;
  successCount: number;
  failureCount: number;
  percentage: number;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface JobType {
  JobTypeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string | null;
  linkedField: string | null;
  RunOrder: number;
}

export interface CountResult {
  totalCount: number;
}

export interface SchedulerState {
  SchedulerJobId: string;
  CurrentJobId: number | null;
  CurrentJobIndex: number | null;
  Status: "running" | "paused" | "completed" | "failed";
  LastUpdated: Date;
  CaseId?: string;
}
