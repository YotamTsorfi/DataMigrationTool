USE [CarmeltonDB_STG]
GO

/****** Object:  UserDefinedTableType [dbo].[BatchUpdateTableType]    Script Date: 29/05/2025 09:18:32 ******/
CREATE TYPE [dbo].[BatchUpdateTableType] AS TABLE(
	[RowId] [int] NULL,
	[BatchId] [uniqueidentifier] NULL,
	[JobName] [nvarchar](255) NULL,
	[Status] [nvarchar](100) NULL,
	[Error] [nvarchar](max) NULL,
	[JobId] [uniqueidentifier] NULL,
	[priority_id] [nvarchar](50) NULL,
	[is_new] [bit] NULL
)
GO


