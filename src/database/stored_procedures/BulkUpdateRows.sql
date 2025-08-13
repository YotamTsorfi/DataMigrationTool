USE [CarmeltonDB_PRD]
GO

/****** Object:  StoredProcedure [dbo].[BulkUpdateRows]    Script Date: 13/08/2025 10:05:06 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
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
                    t.is_new = u.is_new,
					t.StatusCode = u.StatusCode
                FROM ' + QUOTENAME(@TableName) + ' t
                INNER JOIN @Updates u ON t.RowId = u.RowId';
    
    -- Execute the query
    EXEC sp_executesql @sql, N'@Updates dbo.BatchUpdateTableType READONLY', @Updates;
END;
GO


