GO
CREATE OR ALTER PROCEDURE dbo.BulkUpdateRows
    @TableName NVARCHAR(255),
    @Updates dbo.BatchUpdateTableType READONLY
AS
BEGIN
    DECLARE @sql NVARCHAR(MAX);
    
    -- בניית פקודת SQL בצורה בטוחה
    SET @sql = 'UPDATE t
                 SET t.BatchId = u.BatchId,
                     t.JobName = u.JobName,
                     t.Status = u.Status,
                     t.Error = u.ErrorMessage,
                     t.JobId = u.JobId
                 FROM ' + QUOTENAME(@TableName) + ' t
                 INNER JOIN @Updates u ON t.RowId = u.RowId';
    
    -- הרצת השאילתא
    EXEC sp_executesql @sql, N'@Updates dbo.BatchUpdateTableType READONLY', @Updates;
END;
GO