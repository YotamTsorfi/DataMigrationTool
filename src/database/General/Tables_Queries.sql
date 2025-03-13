CREATE TABLE dbo.PriorityJobTypes (
    JobTypeId INT PRIMARY KEY IDENTITY(1,1),
    JobTypeName NVARCHAR(255) NOT NULL,
    DBTableName NVARCHAR(255) NOT NULL,
    ScreenName NVARCHAR(255) NOT NULL,
    CreatedDate DATETIME DEFAULT GETDATE(),
    IsActive BIT DEFAULT 1
);
------------------------------------------------------------------
CREATE TABLE dbo.PriorityErrorLogs (
    JobName NVARCHAR(255) NOT NULL,
    BatchId UNIQUEIDENTIFIER NULL,
    TableName NVARCHAR(255) NOT NULL,
    RowId INT NULL,
    Error NVARCHAR(MAX) NOT NULL,
    Timestamp DATETIME DEFAULT GETDATE(),
    ErrorId INT IDENTITY(1,1) PRIMARY KEY,
    JobId UNIQUEIDENTIFIER NULL,
    ServerName NVARCHAR(255) DEFAULT HOST_NAME(),
    ApplicationName NVARCHAR(255) NULL
);
------------------------------------------------------------------
CREATE TABLE dbo.PriorityBatchProcessing (
    BatchId UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
    StartTime DATETIME DEFAULT GETDATE(),
    EndTime DATETIME NULL,
    TotalRecords INT NOT NULL DEFAULT 0,
    SuccessCount INT NOT NULL DEFAULT 0,
    FailureCount INT NOT NULL DEFAULT 0,
    LastProcessedIndex INT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
    ErrorMessage NVARCHAR(MAX) NULL,
    TableName NVARCHAR(255) NOT NULL,
    JobName NVARCHAR(255) NOT NULL,
    JobId UNIQUEIDENTIFIER NULL,
    CreatedBy NVARCHAR(255) DEFAULT SUSER_SNAME(),
    ProcessingDuration AS DATEDIFF(SECOND, StartTime, ISNULL(EndTime, GETDATE()))
);
------------------------------------------------------------------
CREATE TABLE dbo.PriorityJobsHistory (
    JobId UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
    JobTypeId INT NULL,
    JobName NVARCHAR(255) NOT NULL,
    TableName NVARCHAR(255) NOT NULL,
    ScreenName NVARCHAR(255) NOT NULL,
    StartTime DATETIME DEFAULT GETDATE(),
    EndTime DATETIME NULL,
    TotalRecords INT NOT NULL DEFAULT 0,
    SuccessCount INT NOT NULL DEFAULT 0,
    FailureCount INT NOT NULL DEFAULT 0,
    Status NVARCHAR(20) NOT NULL DEFAULT 'Pending',
    ErrorMessage NVARCHAR(MAX) NULL,
    CreatedBy NVARCHAR(100) DEFAULT SUSER_SNAME(),
    CreatedAt DATETIME DEFAULT GETDATE(),
    ProcessingDuration AS DATEDIFF(SECOND, StartTime, ISNULL(EndTime, GETDATE())),
    ServerName NVARCHAR(255) DEFAULT HOST_NAME()
);
------------------------------------------------------------------
CREATE TABLE dbo.PrioritySystemConfig (
    ConfigId INT IDENTITY(1,1) PRIMARY KEY,
    ConfigKey NVARCHAR(50) NOT NULL UNIQUE,
    ConfigValue NVARCHAR(MAX) NOT NULL,
    Description NVARCHAR(255),
    LastUpdated DATETIME DEFAULT GETDATE(),
    CreatedBy NVARCHAR(100) DEFAULT SUSER_SNAME(),
    IsActive BIT DEFAULT 1,
    ConfigType NVARCHAR(50) NULL,
    AllowedValues NVARCHAR(MAX) NULL
);

