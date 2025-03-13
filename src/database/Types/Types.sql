-- בודק מה קיים
SELECT name 
FROM sys.types 
WHERE is_table_type = 1;

SELECT 
    t.name AS type_name,
    c.name AS column_name,
    c.column_id,
    tp.name AS column_type,
    c.max_length,
    c.precision,
    c.scale
FROM sys.table_types t
JOIN sys.columns c ON t.type_table_object_id = c.object_id
JOIN sys.types tp ON c.user_type_id = tp.user_type_id
WHERE t.name = 'BatchUpdateTableType';
-- WHERE t.name = 'ErrorLogTableType';

---------------------------------------------------------
-- מחק את הטיפוס הקיים
DROP TYPE ErrorLogTableType;

-- User-Defined Table Types

CREATE TYPE dbo.ErrorLogTableType AS TABLE
(
    JobName nvarchar(255),
    BatchId uniqueidentifier,
    TableName nvarchar(255),
    RowId int,
    Error nvarchar(max),
    JobId uniqueidentifier
);


---------------------------------------------------------
-- מחק את הטיפוס הקיים
DROP TYPE BatchUpdateTableType;

CREATE TYPE dbo.BatchUpdateTableType AS TABLE
(
    RowId int,
    BatchId uniqueidentifier,
    JobName nvarchar(255),
    Status nvarchar(100),
    ErrorMessage nvarchar(max),
    JobId uniqueidentifier
);

----------------------------------


SELECT name 
FROM sys.procedures
ORDER BY name;
-- שאילתות היצירה בנפרד