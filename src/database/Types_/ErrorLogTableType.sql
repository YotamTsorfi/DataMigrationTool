USE [CarmeltonDB_STG]
GO

/****** Object:  UserDefinedTableType [dbo].[ErrorLogTableType]    Script Date: 10/05/2025 08:56:31 ******/
CREATE TYPE [dbo].[ErrorLogTableType] AS TABLE(
	[JobName] [nvarchar](255) NOT NULL,
	[BatchId] [uniqueidentifier] NULL,
	[TableName] [nvarchar](255) NOT NULL,
	[RowId] [int] NULL,
	[Error] [nvarchar](max) NOT NULL,
	[JobId] [uniqueidentifier] NULL,
	[ErrorStatus] [nvarchar](50) NULL
)
GO


