USE [CarmeltonDB_PRD]
GO

/****** Object:  StoredProcedure [dbo].[BulkInsertErrorLogs]    Script Date: 10/05/2025 08:54:01 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE   PROCEDURE [dbo].[BulkInsertErrorLogs]
    @Errors dbo.ErrorLogTableType READONLY
AS
BEGIN
    -- Use table variable for improved TempDB performance
    DECLARE @TempErrors TABLE (
        JobName NVARCHAR(255) NOT NULL,
        BatchId UNIQUEIDENTIFIER NULL,
        TableName NVARCHAR(255) NOT NULL,
        RowId INT NULL,
        Error NVARCHAR(MAX) NOT NULL,
        JobId UNIQUEIDENTIFIER NULL,
        ErrorStatus NVARCHAR(50) NULL
    );
    
    -- Copy from parameter table to table variable
    INSERT INTO @TempErrors
    SELECT JobName, BatchId, TableName, RowId, Error, JobId, ErrorStatus 
    FROM @Errors;
    
    -- Then insert to final table
    INSERT INTO PriorityErrorLogs (JobName, BatchId, TableName, RowId, Error, Timestamp, JobId, ErrorStatus)
    SELECT JobName, BatchId, TableName, RowId, Error, GETDATE(), JobId, ErrorStatus FROM @TempErrors;
END;
GO


