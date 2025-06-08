USE [CarmeltonDB_STG]
GO

-- Drop existing procedure
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'BulkUpdateRows')
    DROP PROCEDURE [dbo].[BulkUpdateRows]
GO

CREATE PROCEDURE [dbo].[BulkUpdateRows]
    @TableName NVARCHAR(255),
    @Updates dbo.BatchUpdateTableType READONLY
AS
BEGIN
    -- Direct SQL statement with all expected columns
    DECLARE @sql NVARCHAR(MAX);
    
    SET @sql = 'UPDATE t
                SET t.BatchId = u.BatchId,
                    t.JobName = u.JobName,
                    t.Status = u.Status,
                    t.Error = u.Error,
                    t.CleanError = u.CleanError,
                    t.JobId = u.JobId,
                    t.priority_id = u.priority_id,
                    t.StatusCode = u.StatusCode,
                    t.is_new = u.is_new
                FROM ' + QUOTENAME(@TableName) + ' t
                INNER JOIN @Updates u ON t.RowId = u.RowId';
    
    -- Execute the query
    EXEC sp_executesql @sql, N'@Updates dbo.BatchUpdateTableType READONLY', @Updates;
END;
GO