USE [CarmeltonDB_STG]
GO

-- Drop the existing type first
IF EXISTS (SELECT * FROM sys.types WHERE name = 'BatchUpdateTableType')
    DROP TYPE [dbo].[BatchUpdateTableType]
GO

CREATE TYPE [dbo].[BatchUpdateTableType] AS TABLE(
    [RowId] [int] NULL,
    [BatchId] [uniqueidentifier] NULL,
    [JobName] [nvarchar](255) NULL,
    [Status] [nvarchar](100) NULL,
    [Error] [nvarchar](max) NULL,
    [JobId] [uniqueidentifier] NULL,
    [priority_id] [nvarchar](50) NULL,
    [is_new] [bit] NULL,
    [StatusCode] [int] NULL
)
GO