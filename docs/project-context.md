# This file provides context and documentation for the Carmelton Data Migration Tool

Carmelton Data Migration Tool - Technical Overview
Introduction
The Carmelton Data Migration Tool is a specialized system designed to synchronize data between internal databases and the Priority ERP system. The application features a React-based client interface that lets users schedule and monitor data migration jobs with two main processing methodologies: Queue Processing and Parent-Child Grid Processing.

System Architecture
The system follows a client-server architecture:

Client: React-based interface for job scheduling and monitoring
Server: Node.js/Express backend with specialized data processing capabilities
Database: Stores configuration settings, job history, and source data
Priority API: External ERP system that receives processed data
Client-Server Interaction
Job Initiation Flow

1. The user selects job parameters in the client interface (BatchProcessor.tsx in client\src\components\BatchProcessor.tsx)
2. The job parameters are sent to the server via an API endpoint
3. The server initiates the appropriate processing method based on the job type
4. Progress updates are sent back to the client via Socket.IO
5. The client displays real-time job status and completion metrics

Client (BatchProcessor) → API Request → Server (JobManager) → Processing Engine → Priority API
↓
Client (Dashboard) ← Socket.IO Events ← Progress Updates

Main Processing Methods

1. Queue Processing (processWithQueues in src\jobs\queueJob.ts)
   The Queue Processing method uses a grid-based approach with horizontal parallelism and vertical sequencing for efficient data processing.

Purpose
Process large volumes of independent records with optimal throughput while respecting API rate limits.

Core Components
Horizontal Batching: Multiple parallel queues (determined by HORIZONTAL_BATCH_SIZE)
Vertical Batching: Sequential processing within each queue (determined by VERTICAL_BATCH_SIZE)
Adaptive Rate Limiting: Dynamic throttling based on API response

Processing Flow

1. Initialization:
   Configure error buffer and progress tracking
   Determine batch sizes from configuration
   Chunk Processing:

2. Fetch records in chunks from the database
   Distribute chunks across horizontal queues based on workload balancing

3. Queue Processing:
   Each queue processes its assigned items sequentially
   Items are sent to the Priority API with appropriate retry logic
   Responses are processed and database records are updated

4. Progress Tracking:
   Each queue reports success/failure metrics
   Overall progress is consolidated and reported to the client

5. Error Handling:
   API errors are captured with detailed information
   Database updates reflect success/failure status
   Error buffering optimizes database writes

export async function processWithQueues(
recordCount: number,
startRow: number,
tableName: string,
priorityScreenName: string,
jobType: string,
jobId: string,
priorityIdField?: string,
logErrors: boolean = false,
updateBatchTable: boolean = false
): Promise<any[]> {
// Initialize components and track progress
// Process records in chunks with grid-based approach
// Update database with results
}

2. Parent-Child Grid Processing (processParentChildGridBatches in src\jobs\parentChildsGridProcess.ts)
   The Parent-Child Grid Processing method extends the queue processing concept to handle hierarchical data structures where parent records contain references to child records.

Purpose
Process hierarchical data structures efficiently while maintaining referential integrity between parent and child records.

Core Components
Grid Structure: Similar to queue processing but with parent-child awareness
Hierarchical Data Management: Processes parent records and their associated children
Specialized API Sender: Uses sendParentChildBatch to maintain hierarchy

Processing Flow

1. Initialization:
   Configure processing parameters and error buffer
   Extract child table names for response processing

2. Data Extraction:
   Fetch hierarchical data chunks from the database
   Distribute across horizontal queues while maintaining parent-child relationships

3. Queue Processing:
   Each queue processes records using a specialized processor function
   Child records are linked to their parents during API submissions
   Response processing extracts Priority IDs for both parents and children

4. Relationship Management:
   Priority IDs from parent records are cascaded to children
   Database updates maintain relationships between entities

5. Error Handling:
   Hierarchical error tracking ensures all children are marked when a parent fails
   Specialized error record updates maintain integrity in failure scenarios

export async function processParentChildGridBatches(
totalRecords: number,
startRow: number,
parentTableName: string,
priorityScreenName: string,
jobType: string,
jobId: string,
parentIdField: string,
linkedField: string,
childJobs: ChildJob[],
logErrors: boolean = false,
updateBatchTable: boolean = false
): Promise<BatchResult[]> {
// Initialize processing grid
// Process parent-child relationships in chunks
// Maintain referential integrity during updates
}

Key Differences Between Processing Methods
Feature Queue Processing Parent-Child Grid Processing
Data Structure Flat records Hierarchical records
Processing Model Independent records Related record groups
API Interaction Single record requests Composite record requests
Success Criteria Individual record status Whole hierarchy status
Response Processing Simple ID extraction Hierarchical ID cascading

Performance Optimizations

Both processing methods employ several performance optimization techniques:

1. Adaptive Concurrency: Adjusts parallelism based on system capabilities
2. Workload Balancing: Distributes records across queues evenly
3. Error Buffering: Batches error writes to reduce database load
4. Exponential Backoff: Implements smart retries with increasing delays
5. Rate Limiting: Prevents API throttling through adaptive pacing
6. Memory Management: Releases processed data for garbage collection

Error Handling Strategy
The system employs a comprehensive error handling approach:

1. Categorized Errors: Different handling for network, API, and data errors
2. Contextual Information: Enriches errors with record and batch context
3. Retry Logic: Implements smart retry policies for transient failures
4. Graceful Degradation: Continues processing despite partial failures
5. Detailed Logging: Captures error details for troubleshooting
6. Database Updates: Reflects error status for affected records

Monitoring and Observability
The system provides several mechanisms for monitoring job progress:

1. Progress Tracking: Real-time updates of processed records
2. Success/Failure Metrics: Detailed counts of successful and failed records
3. Performance Monitoring: Timing metrics for different processing phases
4. Job Dashboard: Visual representation of job status and history
5. Error Visibility: Detailed error information for troubleshooting

These comprehensive processing methods enable the system to handle large volumes of data efficiently while maintaining data integrity and providing robust error handling.
