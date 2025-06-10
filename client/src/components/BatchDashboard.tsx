import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import moment from "moment-timezone";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  DashboardContainer,
  SummaryGrid,
  SummaryCard,
  ChartContainer,
  TabContainer,
  Tab,
  TabContent,
  FilterContainer,
  FilterItem,
  DataTable,
  StatusBadge,
  LoadingOverlay,
  Pagination,
} from "../styles/BatchDashboardStyles";
import ErrorGroups from "./ErrorGroups";
import SuccessRecords from "./SuccessRecords";
import ErrorCopyTool from "./ErrorCopyTool";

// Interface definitions
interface DashboardSummary {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  inProgressJobs: number;
  queuedJobs: number;
  notSyncedJobs: number;
  totalRecords: number;
  successRecords: number;
  failureRecords: number;
  successRate: number;
  averageProcessingTime: number;
  todayJobs: number;
  tableCounts: Record<string, number>;
}

interface BatchRecord {
  BatchId: string;
  JobName: string;
  StartTime: string;
  EndTime: string;
  TotalRecords: number;
  SuccessCount: number;
  FailureCount: number;
  Status: string;
  TableName: string;
  JobId: string;
  LastProcessedIndex: number;
  ErrorMessage: string;
}

interface ErrorRecord {
  ErrorId: number;
  JobName: string;
  BatchId: string;
  TableName: string;
  RowId: number;
  Error: string;
  Timestamp: string;
  JobId: string;
}

interface JobHistoryRecord {
  JobId: string;
  JobName: string;
  StartTime: string;
  EndTime: string;
  Status: string;
  TotalRecords: number;
  SuccessCount: number;
  FailureCount: number;
  TableName: string;
  ScreenName: string;
}

// Helper function to format dates
const formatDate = (dateString: string): string => {
  const date = moment.utc(dateString);
  return date.format("DD/MM/YYYY HH:mm:ss");
};

const safeFormat = (
  value: number | null | undefined,
  useLocale = true
): string => {
  if (value == null) return "0";
  return useLocale ? value.toLocaleString() : value.toString();
};

// Chart colors
const COLORS = [
  "#4caf50",
  "#f44336",
  "#2196f3",
  "#ff9800",
  "#9c27b0",
  "#795548",
  "#607d8b",
];

const BatchDashboard: React.FC = () => {
  // State management
  const [activeTab, setActiveTab] = useState("summary");
  const [summary, setSummary] = useState<DashboardSummary>({
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    inProgressJobs: 0,
    queuedJobs: 0,
    notSyncedJobs: 0,
    totalRecords: 0,
    successRecords: 0,
    failureRecords: 0,
    successRate: 0,
    averageProcessingTime: 0,
    todayJobs: 0,
    tableCounts: {},
  });
  const [batchHistory, setBatchHistory] = useState<BatchRecord[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorRecord[]>([]);
  const [jobHistory, setJobHistory] = useState<JobHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Pagination state
  const [batchPage, setBatchPage] = useState(1);
  const [errorPage, setErrorPage] = useState(1);
  //  const [pageSize, setPageSize] = useState(20);
  const pageSize = 20;
  const [totalBatches, setTotalBatches] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);

  // Filters
  const [dateRange, setDateRange] = useState("last7days");
  const [statusFilter, setStatusFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [tableFilter, setTableFilter] = useState("all");

  // Lists for filter dropdowns
  const [availableJobs, setAvailableJobs] = useState<string[]>([]);
  const [availableTables, setAvailableTables] = useState<string[]>([]);

  // Fetch summary data
  useEffect(() => {
    const fetchSummaryData = async () => {
      setIsLoading(true);
      try {
        const params = { dateRange, statusFilter, jobFilter, tableFilter };
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/dashboard/dashboard-summary`,
          { params }
        );
        setSummary(response.data);

        // Extract unique job types and tables for filters
        if (response.data.tableCounts) {
          setAvailableTables(Object.keys(response.data.tableCounts));
        }
      } catch (error) {
        console.error("Error fetching dashboard summary:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSummaryData();

    // Set up polling interval (30 seconds)
    const intervalId = setInterval(fetchSummaryData, 180000); //180000 ms = 3 minutes
    return () => clearInterval(intervalId);
  }, [dateRange, statusFilter, jobFilter, tableFilter]);

  // Fetch job types for filter dropdown
  useEffect(() => {
    const fetchJobTypes = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/job/job-types`
        );
        const jobNames = response.data.map((job: any) => job.JobTypeName);
        setAvailableJobs(jobNames);
      } catch (error) {
        console.error("Error fetching job types:", error);
      }
    };

    fetchJobTypes();
  }, []);

  // Fetch data based on active tab
  useEffect(() => {
    const fetchTabData = async () => {
      setIsLoading(true);

      try {
        if (activeTab === "batches") {
          const response = await axios.get(
            `${process.env.REACT_APP_API_URL}/dashboard/results`,
            {
              params: {
                page: batchPage,
                pageSize,
                dateRange,
                status: statusFilter,
                jobType: jobFilter,
                tableName: tableFilter,
              },
            }
          );
          setBatchHistory(response.data.batchResults);
          setTotalBatches(response.data.total);
        } else if (activeTab === "errors") {
          const response = await axios.get(
            `${process.env.REACT_APP_API_URL}/dashboard/errors`,
            {
              params: {
                page: errorPage,
                pageSize,
                dateRange,
                jobType: jobFilter,
                tableName: tableFilter,
              },
            }
          );
          setErrorLogs(response.data.errorLogs);
          setTotalErrors(response.data.total);
        } else if (activeTab === "jobs") {
          const response = await axios.get(
            `${process.env.REACT_APP_API_URL}/dashboard/jobs-history`,
            {
              params: {
                dateRange,
                status: statusFilter,
                jobType: jobFilter,
                tableName: tableFilter,
              },
            }
          );
          setJobHistory(response.data.jobsHistory);
        }
      } catch (error) {
        console.error(`Error fetching ${activeTab} data:`, error);
      } finally {
        setIsLoading(false);
      }
    };

    if (activeTab !== "summary") {
      fetchTabData();
    }
  }, [
    activeTab,
    batchPage,
    errorPage,
    pageSize,
    dateRange,
    statusFilter,
    jobFilter,
    tableFilter,
  ]);

  // Prepare data for charts
  const statusChartData = useMemo(
    () => [
      { name: "Completed", value: summary.completedJobs },
      { name: "Failed", value: summary.failedJobs },
      { name: "In Progress", value: summary.inProgressJobs },
      { name: "Queued", value: summary.queuedJobs },
      { name: "Not Synced", value: summary.notSyncedJobs },
    ],
    [summary]
  );

  const tableDistributionData = useMemo(
    () =>
      Object.entries(summary.tableCounts || {}).map(([table, count]) => ({
        name: table,
        count,
      })),
    [summary.tableCounts]
  );

  // Calculate max page numbers
  const maxBatchPage = Math.ceil(totalBatches / pageSize);
  const maxErrorPage = Math.ceil(totalErrors / pageSize);

  return (
    <DashboardContainer>
      <h2>Batch Processing Dashboard</h2>

      <FilterContainer>
        <FilterItem>
          <label>Time Range:</label>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </FilterItem>

        <FilterItem>
          <label>Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
            <option value="queued">Queued</option>
            <option value="completedbutnotsynced">
              Completed But Not Synced
            </option>
          </select>
        </FilterItem>

        <FilterItem>
          <label>Job Type:</label>
          <select
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
          >
            <option value="all">All Job Types</option>
            {availableJobs.map((job) => (
              <option key={job} value={job}>
                {job}
              </option>
            ))}
          </select>
        </FilterItem>

        <FilterItem>
          <label>Table:</label>
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          >
            <option value="all">All Tables</option>
            {availableTables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>
        </FilterItem>
      </FilterContainer>

      <TabContainer>
        <Tab
          $active={activeTab === "summary"}
          onClick={() => setActiveTab("summary")}
        >
          Summary
        </Tab>
        <Tab
          $active={activeTab === "jobs"}
          onClick={() => setActiveTab("jobs")}
        >
          Jobs
        </Tab>
        <Tab
          $active={activeTab === "batches"}
          onClick={() => setActiveTab("batches")}
        >
          Batches
        </Tab>
        <Tab
          $active={activeTab === "errors"}
          onClick={() => setActiveTab("errors")}
        >
          Errors
        </Tab>
        <Tab
          $active={activeTab === "errorGroups"}
          onClick={() => setActiveTab("errorGroups")}
        >
          Error Analysis
        </Tab>
        <Tab
          $active={activeTab === "successRecords"}
          onClick={() => setActiveTab("successRecords")}
        >
          Success Records
        </Tab>
        <Tab
          $active={activeTab === "errorCopy"}
          onClick={() => setActiveTab("errorCopy")}
        >
          Error Copy Tool
        </Tab>
      </TabContainer>

      {isLoading && (
        <LoadingOverlay>
          <div className="spinner"></div>
        </LoadingOverlay>
      )}

      {!isLoading && activeTab === "summary" && (
        <TabContent>
          <SummaryGrid>
            <SummaryCard>
              <h3>Total Jobs</h3>
              <p className="number">{safeFormat(summary.totalJobs)}</p>
            </SummaryCard>
            <SummaryCard className="success">
              <h3>Completed Jobs</h3>
              <p className="number">{safeFormat(summary.completedJobs)}</p>
            </SummaryCard>
            <SummaryCard className="error">
              <h3>Failed Jobs</h3>
              <p className="number">{safeFormat(summary.failedJobs)}</p>
            </SummaryCard>
            <SummaryCard className="in-progress">
              <h3>In Progress</h3>
              <p className="number">{safeFormat(summary.inProgressJobs)}</p>
            </SummaryCard>
            <SummaryCard>
              <h3>Total Records</h3>
              <p className="number">
                {summary.totalRecords != null
                  ? summary.totalRecords.toLocaleString()
                  : "0"}
              </p>
            </SummaryCard>
            <SummaryCard className="info">
              <h3>Success Rate</h3>
              <p className="number">
                {summary.successRate != null
                  ? summary.successRate.toFixed(2)
                  : "0.00"}
                %
              </p>
            </SummaryCard>
            <SummaryCard className="info">
              <h3>Avg. Processing Time</h3>
              <p className="number">
                {summary.averageProcessingTime != null
                  ? summary.averageProcessingTime.toFixed(2)
                  : "0.00"}
                s
              </p>
            </SummaryCard>
            <SummaryCard>
              <h3>Today's Jobs</h3>
              <p className="number">{safeFormat(summary.todayJobs)}</p>
            </SummaryCard>
          </SummaryGrid>

          <ChartContainer>
            <h3>Job Status Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name}: ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {statusChartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>

          <ChartContainer>
            <h3>Distribution by Table</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={tableDistributionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#8884d8" name="Number of Jobs" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </TabContent>
      )}

      {!isLoading && activeTab === "jobs" && (
        <TabContent>
          <h3>Jobs History</h3>
          <DataTable>
            <thead>
              <tr>
                <th>Job Id</th>
                <th>Job Name</th>
                <th>Table</th>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Status</th>
                <th>Total Records</th>
                <th>Success</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {jobHistory.map((job) => (
                <tr key={job.JobId}>
                  <td>{job.JobId.substring(0, 8)}...</td>
                  <td>{job.JobName}</td>
                  <td>{job.TableName}</td>
                  <td>{formatDate(job.StartTime)}</td>
                  <td>{job.EndTime ? formatDate(job.EndTime) : "N/A"}</td>
                  <td>
                    <StatusBadge $status={job.Status}>{job.Status}</StatusBadge>
                  </td>
                  <td>
                    {job.TotalRecords != null
                      ? job.TotalRecords.toLocaleString()
                      : "0"}
                  </td>
                  <td>
                    {job.SuccessCount != null
                      ? job.SuccessCount.toLocaleString()
                      : "0"}
                  </td>
                  <td>
                    {job.FailureCount != null
                      ? job.FailureCount.toLocaleString()
                      : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </TabContent>
      )}

      {!isLoading && activeTab === "batches" && (
        <TabContent>
          <h3>Batch History</h3>
          <DataTable>
            <thead>
              <tr>
                <th>Batch Id</th>
                <th>Job Id</th>
                <th>Job Name</th>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Status</th>
                <th>Records</th>
                <th>Last Index</th>
                <th>Success</th>
                <th>Failure</th>
                <th>Error Message</th>
                <th>Table</th>
              </tr>
            </thead>
            <tbody>
              {batchHistory.map((batch) => (
                <tr key={batch.BatchId}>
                  <td>{batch.BatchId.substring(0, 8)}...</td>
                  <td>{batch.JobId.substring(0, 8)}...</td>
                  <td>{batch.JobName}</td>
                  <td>{formatDate(batch.StartTime)}</td>
                  <td>{batch.EndTime ? formatDate(batch.EndTime) : "N/A"}</td>
                  <td>
                    <StatusBadge $status={batch.Status}>
                      {batch.Status}
                    </StatusBadge>
                  </td>
                  <td>{batch.TotalRecords != null ? batch.TotalRecords : 0}</td>
                  <td>
                    {batch.LastProcessedIndex != null
                      ? batch.LastProcessedIndex
                      : 0}
                  </td>
                  <td>{batch.SuccessCount != null ? batch.SuccessCount : 0}</td>
                  <td>{batch.FailureCount != null ? batch.FailureCount : 0}</td>
                  <td>{batch.ErrorMessage}</td>
                  <td>{batch.TableName}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <Pagination>
            <button disabled={batchPage === 1} onClick={() => setBatchPage(1)}>
              First
            </button>
            <button
              disabled={batchPage === 1}
              onClick={() => setBatchPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button className="active">
              {batchPage} of {maxBatchPage}
            </button>
            <button
              disabled={batchPage >= maxBatchPage}
              onClick={() => setBatchPage((p) => Math.min(maxBatchPage, p + 1))}
            >
              Next
            </button>
            <button
              disabled={batchPage >= maxBatchPage}
              onClick={() => setBatchPage(maxBatchPage)}
            >
              Last
            </button>
          </Pagination>
        </TabContent>
      )}

      {!isLoading && activeTab === "errorGroups" && (
        <TabContent>
          <ErrorGroups />
        </TabContent>
      )}

      {!isLoading && activeTab === "successRecords" && (
        <TabContent>
          <SuccessRecords />
        </TabContent>
      )}

      {!isLoading && activeTab === "errorCopy" && (
        <TabContent>
          <ErrorCopyTool />
        </TabContent>
      )}
      {!isLoading && activeTab === "errors" && (
        <TabContent>
          <h3>Error Logs</h3>
          <DataTable>
            <thead>
              <tr>
                <th>Time</th>
                <th>Job Name</th>
                <th>Table</th>
                <th>Row Id</th>
                <th>Error</th>
                <th>Job Id</th>
              </tr>
            </thead>
            <tbody>
              {errorLogs.map((error) => (
                <tr key={error.ErrorId}>
                  <td>{formatDate(error.Timestamp)}</td>
                  <td>{error.JobName}</td>
                  <td>{error.TableName}</td>
                  <td>{error.RowId}</td>
                  <td title={error.Error || ""}>
                    {error.Error
                      ? error.Error.length > 100
                        ? `${error.Error.substring(0, 100)}...`
                        : error.Error
                      : "N/A"}
                  </td>
                  <td>{error.JobId}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <Pagination>
            <button disabled={errorPage === 1} onClick={() => setErrorPage(1)}>
              First
            </button>
            <button
              disabled={errorPage === 1}
              onClick={() => setErrorPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button className="active">
              {errorPage} of {maxErrorPage}
            </button>
            <button
              disabled={errorPage >= maxErrorPage}
              onClick={() => setErrorPage((p) => Math.min(maxErrorPage, p + 1))}
            >
              Next
            </button>
            <button
              disabled={errorPage >= maxErrorPage}
              onClick={() => setErrorPage(maxErrorPage)}
            >
              Last
            </button>
          </Pagination>
        </TabContent>
      )}
    </DashboardContainer>
  );
};

export default BatchDashboard;
