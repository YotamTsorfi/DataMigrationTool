GO
CREATE OR ALTER PROCEDURE dbo.BulkInsertErrorLogs  
    @Errors dbo.ErrorLogTableType READONLY  
AS  
BEGIN  
    INSERT INTO PriorityErrorLogs (JobName, BatchId, TableName, RowId, Error, Timestamp, JobId)  
    SELECT JobName, BatchId, TableName, RowId, Error, GETDATE(), JobId FROM @Errors;  
END;
GO