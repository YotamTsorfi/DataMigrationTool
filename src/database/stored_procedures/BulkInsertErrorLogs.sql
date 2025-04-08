DROP TYPE IF EXISTS dbo.ErrorLogTableType;
CREATE TYPE dbo.ErrorLogTableType AS TABLE
(
    JobName NVARCHAR(255) NOT NULL,
    BatchId UNIQUEIDENTIFIER NULL,
    TableName NVARCHAR(255) NOT NULL,
    RowId INT NULL,
    Error NVARCHAR(MAX) NOT NULL,
    JobId UNIQUEIDENTIFIER NULL,
    ErrorStatus NVARCHAR(50) NULL
);



GO
CREATE OR ALTER PROCEDURE dbo.BulkInsertErrorLogs
    @Errors dbo.ErrorLogTableType READONLY
AS
BEGIN
    INSERT INTO PriorityErrorLogs (JobName, BatchId, TableName, RowId, Error, Timestamp, JobId, ErrorStatus)
    SELECT JobName, BatchId, TableName, RowId, Error, GETDATE(), JobId, ErrorStatus FROM @Errors;
END;
GO