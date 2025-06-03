/\*\*

- This file provides comprehensive documentation for the main processing functions
- in the Carmelton Data Migration Tool: processWithQueues and processParentChildGridBatches.
-
- The documentation includes file locations, function signatures, dependencies,
- processing flow, and relationships between components.
  \*/

// ==================================================================================
// PART 1: QUEUE PROCESSING - processWithQueues
// ==================================================================================

/\*\*

- Location: src/jobs/queueJob.ts
-
- Purpose:
- Process large volumes of independent records with optimal throughput while respecting API rate limits.
- Uses a grid-based approach with horizontal parallelism (multiple queues) and vertical sequencing
- (sequential processing within each queue).
-
- Function Signature:
- export async function processWithQueues(
- recordCount: number, // Total number of records to process
- startRow: number, // Starting row ID for processing
- tableName: string, // Source database table name
- priorityScreenName: string, // Target Priority screen name
- jobType: string, // Type of job being processed
- jobId: string, // Unique job identifier
- priorityIdField?: string, // Field name for Priority ID
- logErrors: boolean = false, // Whether to log detailed errors
- updateBatchTable: boolean = false // Whether to update batch tracking table
- ): Promise<any[]>
-
- Dependencies:
- - ErrorBufferService (src/utils/errorBufferService.ts) - For buffered error handling
- - ProgressTracker (src/utils/progressTracker.ts) - For job progress tracking
- - QueueProcessor (src/services/queueProcessor.ts) - Core queue processing logic
- - configService (src/config/configService.ts) - For system configuration
- - fetchDataChunk (src/services/dataService.ts) - For retrieving data from database
- - performBulkUpdateWithService (src/services/dataService.ts) - For updating database records
- - JobCancellationService (src/utils/jobCancellationService.ts) - For handling job cancellations
-
- Processing Flow:
- 1.  Initialization:
- - Configures error buffer and progress tracking
- - Determines batch sizes from configuration
-
- 2.  Chunk Processing:
- - Fetches records in chunks from the database
- - Distributes chunks across horizontal queues based on workload balancing
-
- 3.  Queue Processing:
- - Each queue processes its assigned items sequentially
- - Items are sent to the Priority API with appropriate retry logic
- - Responses are processed and database records are updated
-
- 4.  Progress Tracking:
- - Each queue reports success/failure metrics
- - Overall progress is consolidated and reported to the client
-
- 5.  Error Handling:
- - API errors are captured with detailed information
- - Database updates reflect success/failure status
- - Error buffering optimizes database writes
-
- Usage:
- Called by JobManager.executeStandardProcessing() in src/jobs/jobManager.ts
- when processing type is "queue"
  \*/

// ==================================================================================
// PART 2: PARENT-CHILD GRID PROCESSING - processParentChildGridBatches
// ==================================================================================

/\*\*

- Location: src/jobs/parentChildsGridProcess.ts
-
- Purpose:
- Process hierarchical data structures efficiently while maintaining referential integrity
- between parent and child records. Extends the queue processing concept to handle
- hierarchical data structures where parent records contain references to child records.
-
- Function Signature:
- export async function processParentChildGridBatches(
- totalRecords: number, // Total number of parent records to process
- startRow: number, // Starting row ID for processing
- parentTableName: string, // Parent table name
- parentScreenName: string, // Parent Priority screen name
- jobType: string, // Type of job being processed
- jobId: string, // Unique job identifier
- parentIdField: string, // Field name for parent Priority ID
- linkedField: string, // Field linking parent and child records
- childJobs: ChildJob[], // Array of child job definitions
- logErrors: boolean = false, // Whether to log detailed errors
- updateBatchTable: boolean = false // Whether to update batch tracking table
- ): Promise<BatchResult[]>
-
- Dependencies:
- - ErrorBufferService (src/utils/errorBufferService.ts) - For buffered error handling
- - ProgressTracker (src/utils/progressTracker.ts) - For job progress tracking
- - QueueProcessor (src/services/queueProcessor.ts) - Core queue processing logic
- - configService (src/config/configService.ts) - For system configuration
- - fetchParentChildChunk (src/services/parentChildChunkFetcher.ts) - For retrieving parent-child data
- - sendParentChildBatch (src/services/priorityParentChildSender.ts) - For sending data to Priority API
- - JobCancellationService (src/utils/jobCancellationService.ts) - For handling job cancellations
- - performBulkUpdateWithService (src/services/dataService.ts) - For updating database records
-
- Processing Flow:
- 1.  Initialization:
- - Configures processing parameters and error buffer
- - Extracts child table names for response processing
-
- 2.  Data Extraction:
- - Fetches hierarchical data chunks from the database
- - Distributes across horizontal queues while maintaining parent-child relationships
-
- 3.  Queue Processing:
- - Each queue processes records using a specialized processor function
- - Child records are linked to their parents during API submissions
- - Response processing extracts Priority IDs for both parents and children
-
- 4.  Relationship Management:
- - Priority IDs from parent records are cascaded to children
- - Database updates maintain relationships between entities
-
- 5.  Error Handling:
- - Hierarchical error tracking ensures all children are marked when a parent fails
- - Specialized error record updates maintain integrity in failure scenarios
-
- Usage:
- Called by JobManager.executeParentChildProcessing() in src/jobs/jobManager.ts
- when processing type is "grid-parent-child"
  \*/

// ==================================================================================
// PART 3: RELATED COMPONENTS AND SERVICES
// ==================================================================================

/\*\*

- QueueProcessor
- Location: src/services/queueProcessor.ts
-
- Purpose:
- Core processing engine that handles sequential processing of items in a queue.
- Used by both processWithQueues and processParentChildGridBatches.
-
- Key Methods:
- - addItems(items: QueueItem[]): Adds items to the queue
- - process(): Processes all items in the queue
- - setItemProcessor(processor): Customizes how each item is processed
- - setProgressListener(listener): Sets callback for progress updates
-
- Relationships:
- - Used by processWithQueues for regular record processing
- - Used by processParentChildGridBatches with a custom item processor for hierarchical data
    \*/

/\*\*

- ErrorBufferService
- Location: src/utils/errorBufferService.ts
-
- Purpose:
- Provides optimized error handling by batching database writes for error records.
-
- Key Methods:
- - getInstance(): Singleton access
- - configure(options): Set buffer size and flush intervals
- - addError(error): Add error to buffer
- - flushAll(): Force flush all buffered errors
-
- Relationships:
- - Used by both processing methods to optimize error handling performance
    \*/

/\*\*

- ProgressTracker
- Location: src/utils/progressTracker.ts
-
- Purpose:
- Tracks and reports job progress for client notifications.
-
- Key Methods:
- - initJob(jobId, totalRecords): Initialize tracking for a job
- - updateProgress(jobId, processed, success, failures): Update job progress
- - completeJob(jobId, status): Mark job as complete
-
- Relationships:
- - Used by both processing methods to report progress to clients via Socket.IO
    \*/

/\*\*

- Parent-Child Data Services
-
- fetchParentChildChunk
- Location: src/services/parentChildChunkFetcher.ts
- Purpose: Fetches parent records with their associated child records
-
- sendParentChildBatch
- Location: src/services/priorityParentChildSender.ts
- Purpose: Sends parent-child data to Priority API
-
- streamParentChildData
- Location: src/services/parentChildDataFetcher.ts
- Purpose: Creates a stream of parent-child data for efficient processing
-
- processParentChildResponse
- Location: src/services/priorityParentChildResponseProcessor.ts
- Purpose: Processes API responses for parent-child data and updates database records
  \*/

/\*\*

- JobManager
- Location: src/jobs/jobManager.ts
-
- Purpose:
- Orchestrates job execution and selects appropriate processing method.
-
- Key Methods related to processing:
- - executeStandardProcessing(): Handles regular queue processing
- - executeParentChildProcessing(): Handles parent-child grid processing
- - startJob(): Entry point for job execution
-
- Processing Selection Logic:
- Based on job configuration or system defaults, JobManager decides whether to use:
- - processWithQueues for standard data
- - processParentChildGridBatches for hierarchical data
    \*/

// ==================================================================================
// PART 4: DATA FLOW AND PROCESSING DIAGRAM
// ==================================================================================

/\*\*

- QUEUE PROCESSING DATA FLOW
-
- Client Request
- ↓
- JobManager.startJob()
- ↓
- JobManager.executeStandardProcessing()
- ↓
- processWithQueues()
- ↓
- Fetch data chunks ← Database
- ↓
- Distribute to horizontal queues
- ↓
- For each queue:
- QueueProcessor.process()
-       ↓
- Send individual records to Priority API → Priority ERP
-       ↓                                         ↓
- Process API responses Process requests
-       ↓                                         ↓
- Update database records → Database ← Return responses
-       ↓
- Aggregate results and return
- ↓
- JobManager updates job status
- ↓
- Client notified via Socket.IO
-
-
- PARENT-CHILD GRID PROCESSING DATA FLOW
-
- Client Request
- ↓
- JobManager.startJob()
- ↓
- JobManager.executeParentChildProcessing()
- ↓
- processParentChildGridBatches()
- ↓
- Fetch parent-child data ← Database
- ↓
- Distribute to horizontal queues
- ↓
- For each queue:
- QueueProcessor.process() with custom processor
-       ↓
- sendParentChildBatch() → Priority ERP
-       ↓                         ↓
- processParentChildResponse() ← Process hierarchical data
-       ↓
- Update parent records → Database
-       ↓
- Update child records with parent IDs → Database
-       ↓
- Aggregate results and return
- ↓
- JobManager updates job status
- ↓
- Client notified via Socket.IO
  \*/

// ==================================================================================
// PART 5: PERFORMANCE CONSIDERATIONS AND CONFIGURATION
// ==================================================================================

/\*\*

- Key Performance Configuration Parameters
-
- HORIZONTAL_BATCH_SIZE (from config)
- Purpose: Controls the number of parallel queues
- Impact: Higher values increase throughput but may overwhelm API
- Default: 40
-
- VERTICAL_BATCH_SIZE (from config)
- Purpose: Controls the number of records processed sequentially in each queue
- Impact: Higher values optimize database operations but may delay progress updates
- Default: 1000
-
- CONCURRENT_BATCHES (for parent-child processing)
- Purpose: Controls the maximum number of concurrent batches
- Impact: Balanced against server capacity and API rate limits
-
- Memory Management:
- - Both processing methods release references to processed data
- - Parent-child processing carefully manages large object references
- - Error buffering prevents memory issues from large error volumes
    \*/
