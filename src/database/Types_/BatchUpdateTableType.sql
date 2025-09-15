USE [CarmeltonDB_PRD]
GO

/****** Object:  UserDefinedTableType [dbo].[BatchUpdateTableType]    Script Date: 15/09/2025 ******/
CREATE TYPE [dbo].[BatchUpdateTableType] AS TABLE(
    [RowId] [int] NULL,
    [BatchId] [uniqueidentifier] NULL,
    [JobName] [nvarchar](255) NULL,
    [Status] [nvarchar](100) NULL,
    [Error] [nvarchar](max) NULL,
    [CleanError] [nvarchar](max) NULL,
    [JobId] [uniqueidentifier] NULL,
    [priority_id] [nvarchar](255) NULL, -- Increased from 50 to 255
    [is_new] [bit] NULL,
    [StatusCode] [int] NULL
)
GO