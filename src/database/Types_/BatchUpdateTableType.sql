USE [CarmeltonDB_STG]
GO

/****** Object:  UserDefinedTableType [dbo].[BatchUpdateTableType]    Script Date: 10/05/2025 08:56:22 ******/
CREATE TYPE [dbo].[BatchUpdateTableType] AS TABLE(
	[RowId] [int] NULL,
	[BatchId] [uniqueidentifier] NULL,
	[JobName] [nvarchar](255) NULL,
	[Status] [nvarchar](100) NULL,
	[ErrorMessage] [nvarchar](max) NULL,
	[JobId] [uniqueidentifier] NULL,
	[priority_id] [nvarchar](50) NULL,
	[is_new] [bit] NULL
)
GO


