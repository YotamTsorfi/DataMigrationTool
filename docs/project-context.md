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

These comprehensive processing methods enable the system to handle large volumes of data efficiently while maintaining data integrity and providing
