# Copilot Code Generation Instructions for TypeScript

- Always use logger.ts from ../../../utils/logger.ts if there is a need for logging into files.
- Use comments just in English to explain complex logic or important sections of code.
- Use TypeScript for all code examples.
- Prefer `const` and `let` over `var`.
- Use `async/await` syntax for asynchronous operations.
- Always include explicit return types for functions and methods.
- Utilize ES6+ features such as arrow functions, template literals, and destructuring.
- Follow naming conventions:
  - camelCase for variables and functions.
  - PascalCase for classes and interfaces.
  - UPPER_CASE for constants.
- Organize imports: external libraries first, then internal modules.
- Use single quotes for strings.
- Include JSDoc comments for all public functions and classes.
- Implement error handling using `try/catch` blocks.
- For React components:
  - Use functional components with hooks.
  - Define prop types using TypeScript interfaces.
  - Name components using PascalCase.
- For API interactions:
  - Use `fetch` or `axios` with typed request and response interfaces.
  - Handle errors gracefully and provide user-friendly messages.
- Ensure all code is formatted using Prettier with the project's configuration.

# Carmelton Data Migration Tool - Technical Architecture

This document provides comprehensive documentation for the main processing functions in the Carmelton Data Migration Tool: processWithQueues and processParentChildGridBatches.

## Main Processing Components

### 1. Queue Processing - processWithQueues

**Location**: `src/jobs/processors/queue/queueJob.ts`

**Purpose**:
Process large volumes of independent records with optimal throughput while respecting API rate limits.
Uses a grid-based approach with horizontal parallelism (multiple queues) and vertical sequencing
(sequential processing within each queue).

**Function Signature**:

```typescript
export async function processWithQueues(
  recordCount: number, // Total number of records to process
  startRow: number, // Starting row ID for processing
  tableName: string, // Source database table name
  priorityScreenName: string, // Target Priority screen name
  jobType: string, // Type of job being processed
  jobId: string, // Unique job identifier
  priorityIdField?: string, // Field name for Priority ID
  logErrors: boolean = false, // Whether to log detailed errors
  updateBatchTable: boolean = false, // Whether to update batch tracking table
  customWhereClause?: string // Optional WHERE clause to filter source records
): Promise<any[]>;
```

**Dependencies**:

- `ErrorBufferService` (`src/utils/errorBufferService.ts`) - For buffered error handling
- `ProgressTracker` (`src/utils/progressTracker.ts`) - For job progress tracking
- `QueueProcessor` (`src/services/processing/queue/queueProcessor.ts`) - Core queue processing logic
- `configService` (`src/config/configService.ts`) - For system configuration
- `fetchDataChunk` (`src/services/database/dataService.ts`) - For retrieving data from database
- `performBulkUpdateWithService` (`src/services/database/dataService.ts`) - For updating database records
- `JobCancellationService` (`src/utils/jobCancellationService.ts`) - For handling job cancellations
- `PerformanceMonitor` (`src/utils/performanceMonitor.ts`) - For tracking processing performance

**Processing Flow**:

1. **Initialization**:

   - Configures error buffer and progress tracking
   - Determines batch sizes from configuration
   - Initializes performance monitoring

2. **Chunk Processing**:

   - Fetches records in chunks from the database with optional WHERE clause filtering
   - Distributes chunks across horizontal queues based on workload balancing

3. **Queue Processing**:

   - Each queue processes its assigned items sequentially
   - Items are sent to the Priority API with appropriate retry logic
   - Responses are processed and database records are updated
   - Progress listeners track success/failure for each queue

4. **Progress Tracking**:

   - Each queue reports success/failure metrics
   - Overall progress is consolidated and reported to the client via Socket.IO
   - Performance metrics are collected for monitoring

5. **Error Handling**:

   - API errors are captured with detailed information
   - Database updates reflect success/failure status
   - Error buffering optimizes database writes
   - Exponential backoff for transient errors

6. **Database Updates**:
   - performDatabaseUpdatesAsync handles asynchronous updates
   - Records are sanitized before writing to the database
   - Bulk update operations with retry mechanisms
   - Handling of deadlock scenarios

**Usage**:
Called by `JobManager.executeStandardProcessing()` in `src/jobs/manager/jobManager.ts`
when processing type is "queue"

### 2. Parent-Child Grid Processing - processParentChildGridBatches

**Location**: `src/jobs/parentChild/parentChildsGridProcess.ts`

**Purpose**:
Process hierarchical data structures efficiently while maintaining referential integrity
between parent and child records. Extends the queue processing concept to handle
hierarchical data structures where parent records contain references to child records.

**Function Signature**:

```typescript
export async function processParentChildGridBatches(
  totalRecords: number, // Total number of parent records to process
  startRow: number, // Starting row ID for processing
  parentTableName: string, // Parent table name
  parentScreenName: string, // Parent Priority screen name
  jobType: string, // Type of job being processed
  jobId: string, // Unique job identifier
  parentIdField: string, // Field name for parent Priority ID
  linkedField: string, // Field linking parent and child records
  childJobs: ChildJob[], // Array of child job definitions
  logErrors: boolean = false, // Whether to log detailed errors
  updateBatchTable: boolean = false // Whether to update batch tracking table
): Promise<BatchResult[]>;
```

**Dependencies**:

- `ErrorBufferService` (`src/utils/errorBufferService.ts`) - For buffered error handling
- `ProgressTracker` (`src/utils/progressTracker.ts`) - For job progress tracking
- `configService` (`src/config/configService.ts`) - For system configuration
- `streamParentChildData` (`src/services/priority/batch/dataPreparer.ts`) - For retrieving parent-child data
- `sendParentChildBatch` (`src/services/priority/batch/batchSender.ts`) - For sending data to Priority API
- `JobCancellationService` (`src/utils/jobCancellationService.ts`) - For handling job cancellations
- `PerformanceMonitor` (`src/utils/performanceMonitor.ts`) - For tracking processing performance
- `pLimit` - For controlling concurrency

**Processing Flow**:

1. **Initialization**:

   - Configures processing parameters and error buffer
   - Extracts child table names for response processing
   - Sets up concurrency limits based on configuration
   - Initializes performance monitoring

2. **Data Extraction**:

   - Uses streamParentChildData to fetch hierarchical data chunks efficiently
   - Leverages AsyncGenerator pattern for memory-efficient data loading
   - Maps child records to their parent records using database foreign keys

3. **Concurrent Batch Processing**:

   - Uses worker pool (pLimit) to control concurrency
   - Each batch is processed independently with parent-child relationships intact
   - Tracks active jobs for workload management

4. **API Interaction**:

   - sendParentChildBatch sends hierarchical data to Priority API
   - Maintains relationships between parent and child records
   - Uses specialized request formatting for hierarchical data

5. **Response Processing**:

   - processParentChildResponse extracts IDs for both parents and children
   - Handles various response formats including arrays and objects
   - Cascades IDs from parent records to their children

6. **Database Updates**:

   - Updates parent records with their Priority IDs
   - Updates child records with related parent IDs and their own IDs
   - Maintains referential integrity in the database

7. **Error Handling**:

   - Hierarchical error tracking ensures all children are marked when a parent fails
   - Specialized error record updates maintain integrity in failure scenarios
   - Tracks consecutive failures for potential intervention

8. **Progress Reporting**:
   - Real-time updates on processing speed and completion percentage
   - Estimated time remaining calculation
   - Detailed performance metrics for different processing phases

**Usage**:
Called by `JobManager.executeParentChildProcessing()` in `src/jobs/manager/jobManager.ts`
when processing type is "grid-parent-child"

## Related Components and Services

### QueueProcessor

**Location**: `src/services/processing/queue/queueProcessor.ts`

**Purpose**:
Core processing engine that handles sequential processing of items in a queue.
Used by both processWithQueues and processParentChildGridBatches.

**Key Methods**:

- `addItems(items: QueueItem[])`: Adds items to the queue
- `process()`: Processes all items in the queue with rate limiting and retry logic
- `setItemProcessor(processor)`: Customizes how each item is processed
- `setProgressListener(listener)`: Sets callback for progress updates
- `formatErrorMessage()`: Creates user-friendly error messages

**Relationships**:

- Used by processWithQueues for regular record processing
- Used by processParentChildGridBatches with a custom item processor for hierarchical data

### ErrorBufferService

**Location**: `src/utils/errorBufferService.ts`

**Purpose**:
Provides optimized error handling by batching database writes for error records.

**Key Methods**:

- `getInstance()`: Singleton access
- `configure(options)`: Set buffer size and flush intervals
- `addError(error)`: Add error to buffer
- `flushAll()`: Force flush all buffered errors
- `setLoggingEnabled(enabled)`: Controls detailed error logging

**Relationships**:

- Used by both processing methods to optimize error handling performance
- Reduces database load during heavy processing

### ProgressTracker

**Location**: `src/utils/progressTracker.ts`

**Purpose**:
Tracks and reports job progress for client notifications.

**Key Methods**:

- `initJob(jobId, totalRecords)`: Initialize tracking for a job
- `updateProgress(jobId, processed, success, failures)`: Update job progress
- `completeJob(jobId, status)`: Mark job as complete
- `getProgress(jobId)`: Retrieve current progress for a job

**Relationships**:

- Used by both processing methods to report progress to clients via Socket.IO
- Integrates with EmailNotificationService for periodic status updates

### Parent-Child Data Services

**streamParentChildData**
**Location**: `src/services/priority/batch/dataPreparer.ts`
**Purpose**: Creates a memory-efficient stream of parent-child data for processing
**Implementation**: Uses AsyncGenerator pattern for lazy evaluation

**sendParentChildBatch**
**Location**: `src/services/priority/batch/batchSender.ts`
**Purpose**: Sends parent-child data to Priority API with appropriate formatting
**Features**: Performance monitoring, error handling, retry logic

**processParentChildResponse**
**Location**: `src/services/priority/batch/batchSender.ts`
**Purpose**: Processes API responses for parent-child data and updates database records
**Capabilities**: Handles various response formats, extracts IDs, maintains relationships

### JobManager

**Location**: `src/jobs/manager/jobManager.ts`

**Purpose**:
Orchestrates job execution and selects appropriate processing method.

**Key Methods related to processing**:

- `executeStandardProcessing()`: Handles regular queue processing
- `executeParentChildProcessing()`: Handles parent-child grid processing
- `startJob()`: Entry point for job execution
- `updateJobStatus()`: Updates job records in database

**Processing Selection Logic**:
Based on job configuration or system defaults, JobManager decides whether to use:

- processWithQueues for standard data
- processParentChildGridBatches for hierarchical data

## Data Flow and Processing Diagram

### QUEUE PROCESSING DATA FLOW

Client Request
↓
JobManager.startJob()
↓
JobManager.executeStandardProcessing()
↓
processWithQueues()
↓
Fetch data chunks ← Database
↓
Distribute to horizontal queues
↓
For each queue:
QueueProcessor.process()
↓
Send individual records to Priority API → Priority ERP
↓ ↓
Process API responses Process requests
↓ ↓
Update database records → Database ← Return responses
↓
Aggregate results and return
↓
JobManager updates job status
↓
Client notified via Socket.IO

### PARENT-CHILD GRID PROCESSING DATA FLOW

Client Request
↓
JobManager.startJob()
↓
JobManager.executeParentChildProcessing()
↓
processParentChildGridBatches()
↓
streamParentChildData generates hierarchical records ← Database
↓
Distribute to concurrent worker pool (pLimit)
↓
For each batch:
sendParentChildBatch() → Priority ERP
↓ ↓
processParentChildResponse() ← Process hierarchical data
↓
Update parent records → Database
↓
Update child records with parent IDs → Database
↓
Aggregate results and calculate performance metrics
↓
JobManager updates job status
↓
Client notified via Socket.IO

## Performance Considerations and Configuration

### Key Performance Configuration Parameters

**HORIZONTAL_BATCH_SIZE** (from config)
**Purpose**: Controls the number of parallel queues
**Impact**: Higher values increase throughput but may overwhelm API
**Default**: 40

**VERTICAL_BATCH_SIZE** (from config)
**Purpose**: Controls the number of records processed sequentially in each queue
**Impact**: Higher values optimize database operations but may delay progress updates
**Default**: 1000

**CONCURRENT_BATCHES** (for parent-child processing)
**Purpose**: Controls the maximum number of concurrent API request batches
**Impact**: Balanced against server capacity, API rate limits, and database load
**Adaptive**: Scales based on available server resources (calculated from server count)

### Memory Management:

- Both processing methods release references to processed data
- Parent-child processing uses AsyncGenerator pattern for memory efficiency
- Error buffering prevents memory issues from large error volumes
- Garbage collection assistance in cleanup phases

### Database Optimizations:

- Bulk update operations for improved performance
- Table schema caching for frequent operations
- Temporary tables for large join operations
- Deadlock handling and retry mechanisms
- Adaptive column type selection based on data content

# Carmelton Data Migration Tool - Technical Overview

## Introduction

The Carmelton Data Migration Tool is a specialized system designed to synchronize data between internal databases and the Priority ERP system. The application features a React-based client interface that lets users schedule and monitor data migration jobs with two main processing methodologies: Queue Processing and Parent-Child Grid Processing.

## System Architecture

The system follows a client-server architecture:

- **Client**: React-based interface for job scheduling and monitoring
- **Server**: Node.js/Express backend with specialized data processing capabilities
- **Database**: Stores configuration settings, job history, and source data
- **Priority API**: External ERP system that receives processed data

## Folder Structure

### Server Structure

- `config/` - Configuration and environment settings
- `controllers/` - HTTP request handlers for different resources
- `database/` - Database setup, stored procedures, and SQL scripts
- `jobs/` - Core job processing logic
  - `manager/` - Job orchestration and management
  - `parentChild/` - Hierarchical data processing
  - `processors/` - Various processing implementations
- `middleware/` - Express middleware functions
- `models/` - Data models and schemas
- `routers/` - API route definitions
- `scripts/` - Utility scripts
- `services/` - Business logic services
  - `database/` - Database interaction services
  - `priority/` - Priority API integration services
  - `processing/` - Data processing services
- `types/` - TypeScript type definitions
- `utils/` - Utility functions and helpers

### Client Structure

- `components/` - React UI components
  - `JobScheduler/` - Job configuration interface
  - `JobTypesManager/` - Job types management
- `context/` - React context providers
- `hooks/` - Custom React hooks
- `services/` - Client-side services
- `styles/` - CSS and component styles

## Deployment Architecture

The application can be deployed in multiple environments:

- **Development**: Local environment with .env.development configuration
- **Production**: Server deployment with .env.production configuration
- **Docker**: Containerized deployment using Docker and Docker Compose
- **CI/CD**: Automated deployment via Jenkins pipeline

## Client-Server Interaction

### Job Initiation Flow

1. The user selects job parameters in the client interface (`client/src/components/BatchProcessor.tsx`)
2. The job parameters are sent to the server via an API endpoint
3. The server initiates the appropriate processing method based on the job type
4. Progress updates are sent back to the client via Socket.IO
5. The client displays real-time job status and completion metrics

Client (BatchProcessor) → API Request → Server (JobManager) → Processing Engine → Priority API
↓
Client (Dashboard) ← Socket.IO Events ← Progress Updates

## Main Processing Methods

### 1. Queue Processing (processWithQueues in src/jobs/processors/queue/queueJob.ts)

The Queue Processing method uses a grid-based approach with horizontal parallelism and vertical sequencing for efficient data processing.

#### Purpose

Process large volumes of independent records with optimal throughput while respecting API rate limits.

#### Core Components

- **Horizontal Batching**: Multiple parallel queues (determined by HORIZONTAL_BATCH_SIZE)
- **Vertical Batching**: Sequential processing within each queue (determined by VERTICAL_BATCH_SIZE)
- **Adaptive Rate Limiting**: Dynamic throttling based on API response times
- **Intelligent Retry Logic**: Exponential backoff for failed requests

#### Processing Flow

1. **Initialization**:

   - Configure error buffer and progress tracking
   - Determine batch sizes from configuration
   - Set up performance monitoring

2. **Chunk Processing**:

   - Fetch records in chunks from the database
   - Apply custom WHERE clauses for filtering when specified
   - Distribute chunks across horizontal queues based on workload balancing

3. **Queue Processing**:

   - Each queue processes its assigned items sequentially
   - Items are sent to the Priority API with appropriate retry logic
   - Responses are processed and database records are updated
   - Progress updates are emitted for real-time monitoring

4. **Progress Tracking**:

   - Each queue reports success/failure metrics
   - Overall progress is consolidated and reported to the client
   - Performance metrics are collected for system optimization

5. **Error Handling**:
   - API errors are captured with detailed information
   - Database updates reflect success/failure status
   - Error buffering optimizes database writes
   - Specialized handling for different error types (network, API, data)

### 2. Parent-Child Grid Processing (processParentChildGridBatches in src/jobs/parentChild/parentChildsGridProcess.ts)

The Parent-Child Grid Processing method extends the queue processing concept to handle hierarchical data structures where parent records contain references to child records.

#### Purpose

Process hierarchical data structures efficiently while maintaining referential integrity between parent and child records.

#### Core Components

- **Worker Pool**: Controlled concurrency for batch processing
- **Hierarchical Data Management**: Processes parent records and their associated children
- **Memory-Efficient Data Streaming**: Uses AsyncGenerator pattern for processing large datasets
- **Specialized API Sender**: Uses sendParentChildBatch to maintain hierarchy

#### Processing Flow

1. **Initialization**:

   - Configure processing parameters and error buffer
   - Extract child table names for response processing
   - Set concurrency levels based on system capacity

2. **Data Extraction**:

   - Fetch hierarchical data chunks from the database using streaming
   - Build parent-child relationships using Map data structures
   - Optimize memory usage for large datasets

3. **Concurrent Batch Processing**:

   - Distribute batches to worker pool while maintaining parent-child relationships
   - Track active jobs for workload management
   - Monitor processing speed and provide ETA estimates

4. **API Interaction**:

   - Format hierarchical data for Priority API
   - Send composite requests with parent and child records
   - Handle responses with complex structure

5. **Response Processing**:

   - Extract Priority IDs for both parents and children
   - Handle various response formats (arrays, objects)
   - Maintain referential integrity between related records

6. **Relationship Management**:

   - Priority IDs from parent records are cascaded to children
   - Database updates maintain relationships between entities
   - Child records reference their parent records via foreign keys

7. **Error Handling**:
   - Hierarchical error tracking ensures all children are marked when a parent fails
   - Specialized error record updates maintain integrity in failure scenarios
   - Consecutive failure tracking for potential intervention

## Key Differences Between Processing Methods

| Feature             | Queue Processing         | Parent-Child Grid Processing |
| ------------------- | ------------------------ | ---------------------------- |
| Data Structure      | Flat records             | Hierarchical records         |
| Processing Model    | Independent records      | Related record groups        |
| API Interaction     | Single record requests   | Composite record requests    |
| Success Criteria    | Individual record status | Whole hierarchy status       |
| Response Processing | Simple ID extraction     | Hierarchical ID cascading    |
| Memory Usage        | Linear scaling           | Optimized for relationships  |

## Performance Optimizations

Both processing methods employ several performance optimization techniques:

1. **Adaptive Concurrency**: Adjusts parallelism based on system capabilities and server count
2. **Workload Balancing**: Distributes records across processing units evenly
3. **Error Buffering**: Batches error writes to reduce database load
4. **Exponential Backoff**: Implements smart retries with increasing delays
5. **Rate Limiting**: Prevents API throttling through adaptive pacing
6. **Memory Management**: Releases processed data for garbage collection
7. **Database Optimizations**:
   - Bulk operations for updates
   - Schema caching for frequent operations
   - Temporary tables for large joins
   - Smart retry logic for deadlocks

## Error Handling Strategy

The system employs a comprehensive error handling approach:

1. **Categorized Errors**: Different handling for network, API, and data errors
2. **Contextual Information**: Enriches errors with record and batch context
3. **Retry Logic**: Implements smart retry policies for transient failures
4. **Graceful Degradation**: Continues processing despite partial failures
5. **Detailed Logging**: Captures error details for troubleshooting
6. **Database Updates**: Reflects error status for affected records
7. **Error Buffering**: Optimizes database writes for error records

## Monitoring and Observability

The system provides several mechanisms for monitoring job progress:

1. **Progress Tracking**: Real-time updates of processed records
2. **Success/Failure Metrics**: Detailed counts of successful and failed records
3. **Performance Monitoring**: Timing metrics for different processing phases
4. **Job Dashboard**: Visual representation of job status and history
5. **Error Visibility**: Detailed error information for troubleshooting
6. **Email Notifications**: Configurable alerts for long-running jobs
7. **ETA Calculations**: Estimated completion time based on processing speed

## Web Client Interface

The React-based client interface provides several key features:

1. **Job Scheduling**: Interface for configuring and initiating jobs (`components/BatchProcessor.tsx`)
2. **Real-Time Monitoring**: Live updates on job progress via Socket.IO (`components/JobProgressTracker.tsx`)
3. **Job History**: Historical record of completed jobs and their outcomes (`components/BatchDashboard.tsx`)
4. **Error Analysis**: Tools for investigating failed records (`components/ErrorGroups.tsx`)
5. **Configuration Management**: Interface for system settings (`components/ConfigPanel.tsx`)
6. **User Authentication**: Secure access controls (`context/AuthContext.tsx`)
7. **Job Type Management**: Configuration of different job types and parameters (`components/JobTypesManager/JobTypesManager.tsx`)

## Deployment Considerations

The system is designed for flexible deployment:

1. **Containerization**: Docker support for consistent environments
2. **CI/CD Integration**: Jenkins pipeline for automated deployment
3. **Environment Configuration**: Separate development and production settings
4. **Web Server Integration**: Support for IIS in Windows environments
5. **Process Management**: PM2 for Node.js process monitoring and management

These comprehensive processing methods enable the system to handle large volumes of data efficiently while maintaining data integrity and providing robust error handling.
