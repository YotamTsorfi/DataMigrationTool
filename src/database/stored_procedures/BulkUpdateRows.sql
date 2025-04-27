-- קודם מוחקים את הפרוצדורה (כי היא תלויה בטבלת הסוג)
IF EXISTS (SELECT * FROM sys.procedures WHERE name = 'BulkUpdateRows')
    DROP PROCEDURE dbo.BulkUpdateRows;
GO

-- אחר כך מוחקים את טבלת הסוג
IF EXISTS (SELECT * FROM sys.types WHERE name = 'BatchUpdateTableType')
    DROP TYPE dbo.BatchUpdateTableType;
GO

-- ואז יוצרים את טבלת הסוג
-- יוצרים את טבלת הסוג מחדש עם השדה is_new
CREATE TYPE dbo.BatchUpdateTableType AS TABLE(
    [RowId] [int] NULL,
    [BatchId] [uniqueidentifier] NULL,
    [JobName] [nvarchar](255) NULL,
    [Status] [nvarchar](100) NULL,
    [ErrorMessage] [nvarchar](max) NULL,
    [JobId] [uniqueidentifier] NULL,
    [priority_id] [nvarchar](50) NULL,
    [is_new] [bit] NULL
);
GO



-- יצירת הפרוצדורה המעודכנת
CREATE OR ALTER PROCEDURE dbo.BulkUpdateRows
    @TableName NVARCHAR(255),
    @Updates dbo.BatchUpdateTableType READONLY
AS
BEGIN
    DECLARE @sql NVARCHAR(MAX);
    DECLARE @hasPriorityId BIT = 0;
    DECLARE @hasIsNew BIT = 0;
    
    -- בדיקה האם העמודות קיימות בטבלה
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
    ';
    
    EXEC sp_executesql @checkColumnSql, 
        N'@TableName NVARCHAR(255), @hasPriorityId BIT OUTPUT, @hasIsNew BIT OUTPUT', 
        @TableName, @hasPriorityId OUTPUT, @hasIsNew OUTPUT;
    
    -- בניית פקודת SQL
    SET @sql = 'UPDATE t
                SET t.BatchId = u.BatchId,
                    t.JobName = u.JobName,
                    t.Status = u.Status,
                    t.Error = u.ErrorMessage,
                    t.JobId = u.JobId';
    
    -- הוספת עמודת priority_id אם קיימת
    IF @hasPriorityId = 1
    BEGIN
        SET @sql = @sql + ',
                    t.priority_id = u.priority_id';
    END
    
    -- הוספת עדכון is_new אם קיימת - הגדרת 0 כאשר הסטטוס הוא Completed
    IF @hasIsNew = 1
    BEGIN
        SET @sql = @sql + ',
                    t.is_new = CASE WHEN u.Status = ''Completed'' THEN 0 ELSE t.is_new END';
    END
    
    SET @sql = @sql + '
                FROM ' + QUOTENAME(@TableName) + ' t
                INNER JOIN @Updates u ON t.RowId = u.RowId';
    
    -- הרצת השאילתא
    EXEC sp_executesql @sql, N'@Updates dbo.BatchUpdateTableType READONLY', @Updates;
END;
GO