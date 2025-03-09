import React, { useState, useEffect } from "react";
import axios from "axios";
import moment from "moment-timezone";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  MainContainer,
  SectionContainer,
  InputContainer,
  InputLabel,
  Button,
  TableContainer,
  Table,
  Th,
  Td,
  ReadOnlyInput,
  ResultsContainer,
  LargeSectionContainer,
} from "./BatchProcessorStyles";
import BatchDashboard from "./BatchDashboard";

const formatDate = (dateString: string): string => {
  const date = moment.utc(dateString);
  return date.format("DD/MM/YYYY HH:mm:ss");
};

interface JobType {
  JobTypeID: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
}

interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
  jobType: string;
}

const BatchProcessor: React.FC = () => {
  const [recordCount, setRecordCount] = useState(100);
  const [startRow, setStartRow] = useState(1);
  const [tableName, setTableName] = useState("");
  const [priorityScreenName, setPriorityScreenName] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [batchResults, setBatchResults] = useState([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [selectedJobType, setSelectedJobType] = useState("");
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [jobsHistory, setJobsHistory] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get("http://localhost:3001/job/results", {
          params: { tableName },
        });
        setBatchResults(response.data.batchResults);
      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
    };

    const fetchErrorLogs = async () => {
      try {
        const response = await axios.get("http://localhost:3001/job/errors");
        setErrorLogs(response.data.errorLogs);
      } catch (error) {
        console.error("Error fetching error logs:", error);
      }
    };

    fetchData();
    fetchErrorLogs();
  }, [tableName]);

  useEffect(() => {
    const fetchJobTypes = async () => {
      try {
        const response = await axios.get("http://localhost:3001/job/job-types");
        setJobTypes(response.data);
      } catch (error) {
        console.error("Error fetching job types:", error);
      }
    };

    fetchJobTypes();
  }, []);

  useEffect(() => {
    const fetchJobsHistory = async () => {
      try {
        const response = await axios.get(
          "http://localhost:3001/job/jobs-history"
        );
        setJobsHistory(response.data.jobsHistory);
      } catch (error) {
        console.error("Error fetching jobs history:", error);
      }
    };

    fetchJobsHistory();
  }, []);

  const handleJobTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedJob = jobTypes.find(
      (job) => job.JobTypeName === e.target.value
    );
    if (selectedJob) {
      setTableName(selectedJob.DBTableName);
      setPriorityScreenName(selectedJob.ScreenName);
    } else {
      setTableName("");
      setPriorityScreenName("");
    }
    setSelectedJobType(e.target.value);
  };

  const handleBatchProcess = async () => {
    if (!tableName || !priorityScreenName) {
      toast.error("Table Name and Priority Screen Name are required.");
      return;
    }

    setIsProcessing(true);

    try {
      await axios.post("http://localhost:3001/job/run-job", {
        recordCount,
        startRow,
        tableName,
        priorityScreenName,
        jobType: selectedJobType,
      });
      const response = await axios.get("http://localhost:3001/job/results", {
        params: { tableName },
      });
      setBatchResults(response.data.batchResults);
      const errorResponse = await axios.get("http://localhost:3001/job/errors");
      setErrorLogs(errorResponse.data.errorLogs);
      const jobsHistoryResponse = await axios.get(
        "http://localhost:3001/job/jobs-history"
      );
      setJobsHistory(jobsHistoryResponse.data.jobsHistory);
    } catch (error) {
      console.error("Batch process error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([]);
  const [jobRequests, setJobRequests] = useState<JobRequest[]>([]);

  const handleMultipleJobTypeChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedOptions = Array.from(
      e.target.selectedOptions,
      (option) => option.value
    );
    setSelectedJobTypes(selectedOptions);

    const newJobRequests = selectedOptions.map((jobType) => {
      const selectedJob = jobTypes.find((job) => job.JobTypeName === jobType);
      return {
        recordCount: 100,
        startRow: 1,
        tableName: selectedJob?.DBTableName || "",
        priorityScreenName: selectedJob?.ScreenName || "",
        jobType,
      };
    });

    setJobRequests(newJobRequests);
  };

  const handleJobRequestChange = (index: number, field: string, value: any) => {
    const newJobRequests = [...jobRequests];
    newJobRequests[index] = { ...newJobRequests[index], [field]: value };
    setJobRequests(newJobRequests);
  };

  const handleMultipleBatchProcess = async () => {
    if (jobRequests.some((job) => !job.tableName || !job.priorityScreenName)) {
      toast.error("All jobs must have Table Name and Priority Screen Name.");
      return;
    }

    setIsProcessing(true);

    try {
      await axios.post(
        "http://localhost:3001/job/run-multiple-jobs",
        jobRequests
      );
      const response = await axios.get("http://localhost:3001/job/results", {
        params: { tableName },
      });
      setBatchResults(response.data.batchResults);
      const errorResponse = await axios.get("http://localhost:3001/job/errors");
      setErrorLogs(errorResponse.data.errorLogs);
      const jobsHistoryResponse = await axios.get(
        "http://localhost:3001/job/jobs-history"
      );
      setJobsHistory(jobsHistoryResponse.data.jobsHistory);
    } catch (error) {
      console.error("Batch process error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <ToastContainer />
      <MainContainer>
        <SectionContainer>
          <h2>Batch Processor</h2>
          <InputContainer>
            <InputLabel>
              Job Type:
              <select value={selectedJobType} onChange={handleJobTypeChange}>
                <option value="">Select Job Type</option>
                {jobTypes.map((job: any) => (
                  <option key={job.JobTypeID} value={job.JobTypeName}>
                    {job.JobTypeName}
                  </option>
                ))}
              </select>
            </InputLabel>
            <InputLabel>
              Record Count:
              <input
                type="number"
                value={recordCount}
                onChange={(e) => setRecordCount(Number(e.target.value))}
              />
            </InputLabel>
            <InputLabel>
              Start Row:
              <input
                type="number"
                value={startRow}
                onChange={(e) => setStartRow(Number(e.target.value))}
              />
            </InputLabel>
            <InputLabel>
              DB Table Name:
              <ReadOnlyInput
                type="text"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                readOnly
              />
            </InputLabel>
            <InputLabel>
              Priority Screen Name:
              <ReadOnlyInput
                type="text"
                value={priorityScreenName}
                onChange={(e) => setPriorityScreenName(e.target.value)}
                readOnly
              />
            </InputLabel>
          </InputContainer>

          <Button
            onClick={handleBatchProcess}
            disabled={isProcessing}
            className={`process-button ${isProcessing ? "processing" : ""}`}
          >
            {isProcessing ? "Processing..." : "Process Batch"}
          </Button>
          <BatchDashboard batchResults={batchResults} />
        </SectionContainer>

        <SectionContainer>
          <h2>Run Multiple Jobs</h2>
          <InputContainer>
            <InputLabel>
              Job Types:
              <select
                multiple
                value={selectedJobTypes}
                onChange={handleMultipleJobTypeChange}
              >
                <option value="">Select Job Types</option>
                {jobTypes.map((job: any) => (
                  <option key={job.JobTypeID} value={job.JobTypeName}>
                    {job.JobTypeName}
                  </option>
                ))}
              </select>
            </InputLabel>
          </InputContainer>

          {jobRequests.map((jobRequest, index) => (
            <InputContainer key={index}>
              <h3>{jobRequest.jobType}</h3>
              <InputLabel>
                Record Count:
                <input
                  type="number"
                  value={jobRequest.recordCount}
                  onChange={(e) =>
                    handleJobRequestChange(
                      index,
                      "recordCount",
                      Number(e.target.value)
                    )
                  }
                />
              </InputLabel>
              <InputLabel>
                Start Row:
                <input
                  type="number"
                  value={jobRequest.startRow}
                  onChange={(e) =>
                    handleJobRequestChange(
                      index,
                      "startRow",
                      Number(e.target.value)
                    )
                  }
                />
              </InputLabel>
              <InputLabel>
                DB Table Name:
                <ReadOnlyInput
                  type="text"
                  value={jobRequest.tableName}
                  readOnly
                />
              </InputLabel>
              <InputLabel>
                Priority Screen Name:
                <ReadOnlyInput
                  type="text"
                  value={jobRequest.priorityScreenName}
                  readOnly
                />
              </InputLabel>
            </InputContainer>
          ))}

          <Button
            onClick={handleMultipleBatchProcess}
            disabled={isProcessing}
            className={`process-button ${isProcessing ? "processing" : ""}`}
          >
            {isProcessing ? "Processing..." : "Process Multiple Jobs"}
          </Button>

          <h2>Selected Jobs</h2>
          <ul>
            {selectedJobTypes.map((jobType, index) => (
              <li key={index}>{jobType}</li>
            ))}
          </ul>
        </SectionContainer>
      </MainContainer>

      <ResultsContainer>
        {jobsHistory.length > 0 && (
          <LargeSectionContainer>
            <h3>Jobs History</h3>
            <TableContainer>
              <Table>
                <thead>
                  <tr>
                    <Th>Job ID</Th>
                    <Th>Job Name</Th>
                    <Th>Start Time</Th>
                    <Th>End Time</Th>
                    <Th>Status</Th>
                    <Th>Total Records</Th>
                    <Th>Success Batches</Th>
                    <Th>Failure Batches</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobsHistory.map((history: any, index: number) => (
                    <tr key={index}>
                      <Td>{history.JobID}</Td>
                      <Td>{history.JobName}</Td>
                      <Td>{formatDate(history.StartTime)}</Td>
                      <Td>{formatDate(history.EndTime)}</Td>
                      <Td>{history.Status}</Td>
                      <Td>{history.TotalRecords}</Td>
                      <Td>{history.SuccessCount}</Td>
                      <Td>{history.FailureCount}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
          </LargeSectionContainer>
        )}

        {batchResults.length > 0 && (
          <LargeSectionContainer>
            <h3>Batches Results</h3>
            <TableContainer>
              <Table>
                <thead>
                  <tr>
                    <Th>Job Name</Th>
                    <Th>Batch ID</Th>
                    <Th>Job ID</Th>
                    <Th>Start Time</Th>
                    <Th>End Time</Th>
                    <Th>Table Name</Th>
                    <Th>Total Records</Th>
                    <Th>Success Count</Th>
                    <Th>Last Processed Index</Th>
                    <Th>Failure Count</Th>
                    <Th>Status</Th>
                    <Th>Error Message</Th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((result: any, index: number) => (
                    <tr key={index}>
                      <Td>{result.JobName}</Td>
                      <Td>{result.BatchID}</Td>
                      <Td>{result.JobID}</Td>
                      <Td>{formatDate(result.StartTime)}</Td>
                      <Td>{formatDate(result.EndTime)}</Td>
                      <Td>{result.TableName}</Td>
                      <Td>{result.TotalRecords}</Td>
                      <Td>{result.SuccessCount}</Td>
                      <Td>{result.LastProcessedIndex}</Td>
                      <Td>{result.FailureCount}</Td>
                      <Td>{result.Status}</Td>
                      <Td>{result.ErrorMessage}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
          </LargeSectionContainer>
        )}

        {errorLogs.length > 0 && (
          <LargeSectionContainer>
            <h3>Error Logs</h3>
            <TableContainer>
              <Table>
                <thead>
                  <tr>
                    <Th>Error ID</Th>
                    <Th>Job Name</Th>
                    <Th>Job ID</Th>
                    <Th>Batch Id</Th>
                    <Th>TableName</Th>
                    <Th>Error Message</Th>
                    <Th>RowId</Th>
                    <Th>Timestamp</Th>
                  </tr>
                </thead>
                <tbody>
                  {errorLogs.map((log: any, index: number) => (
                    <tr key={index}>
                      <Td>{log.ErrorID}</Td>
                      <Td>{log.JobName}</Td>
                      <Td>{log.JobID}</Td>
                      <Td>{log.BatchId}</Td>
                      <Td>{log.TableName}</Td>
                      <Td>{log.Error}</Td>
                      <Td>{log.RowId}</Td>
                      <Td>{formatDate(log.Timestamp)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableContainer>
          </LargeSectionContainer>
        )}
      </ResultsContainer>
    </div>
  );
};

export default BatchProcessor;
