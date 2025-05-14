USE [CarmeltonDB_STG]
GO

/****** Object:  StoredProcedure [dbo].[BulkUpdateRows]    Script Date: 10/05/2025 08:54:19 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


-- יצירת הפרוצדורה המעודכנת
CREATE   PROCEDURE [dbo].[BulkUpdateRows]
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


