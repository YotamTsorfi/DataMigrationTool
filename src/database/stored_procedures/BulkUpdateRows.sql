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
    DECLARE @sql NVARCHAR(MAX);
    DECLARE @hasPriorityId BIT = 0;
    DECLARE @hasIsNew BIT = 0;
    DECLARE @hasStatusCode BIT = 0;
    
    -- Check if the columns exist in the table
    DECLARE @checkColumnSql NVARCHAR(MAX) = N'
        IF EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = @TableName 
            AND COLUMN_NAME = ''priority_id''
        )
        SET @hasPriorityId = 1;
        
        IF EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = @TableName 
            AND COLUMN_NAME = ''is_new''
        )
        SET @hasIsNew = 1;
        
        IF EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = @TableName 
            AND COLUMN_NAME = ''StatusCode''
        )
        SET @hasStatusCode = 1;
    ';
    
    EXEC sp_executesql @checkColumnSql, 
        N'@TableName NVARCHAR(255), @hasPriorityId BIT OUTPUT, @hasIsNew BIT OUTPUT, @hasStatusCode BIT OUTPUT', 
        @TableName, @hasPriorityId OUTPUT, @hasIsNew OUTPUT, @hasStatusCode OUTPUT;
    
    -- Build the SQL statement
    SET @sql = 'UPDATE t
                SET t.BatchId = u.BatchId,
                    t.JobName = u.JobName,
                    t.Status = u.Status,
                    t.Error = u.Error,
                    t.JobId = u.JobId';
    
    -- Add priority_id if it exists
    IF @hasPriorityId = 1
    BEGIN
        SET @sql = @sql + ',
                    t.priority_id = u.priority_id';
    END
    
    -- Add StatusCode if it exists
    IF @hasStatusCode = 1
    BEGIN
        SET @sql = @sql + ',
                    t.StatusCode = u.StatusCode';
    END
    
    -- Add is_new if it exists - set to 0 when Status is Completed
    IF @hasIsNew = 1
    BEGIN
        SET @sql = @sql + ',
                    t.is_new = CASE WHEN u.Status = ''Completed'' THEN 0 ELSE t.is_new END';
    END
    
    SET @sql = @sql + '
                FROM ' + QUOTENAME(@TableName) + ' t
                INNER JOIN @Updates u ON t.RowId = u.RowId';
    
    -- Execute the query
    EXEC sp_executesql @sql, N'@Updates dbo.BatchUpdateTableType READONLY', @Updates;
END;
GO