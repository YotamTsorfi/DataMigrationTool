// client/src/components/BatchProcessor.tsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import moment from "moment-timezone";
import {
  Container,
  InputContainer,
  InputLabel,
  Button,
  TableContainer,
  Table,
  Th,
  Td,
  FlexContainer,
  ReadOnlyInput,
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
    } catch (error) {
      console.error("Batch process error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="batch-processor">
      <Container>
        <FlexContainer>
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
        </FlexContainer>
        <BatchDashboard batchResults={batchResults} />
      </Container>

      {batchResults.length > 0 && (
        <>
          <TableContainer>
            <h3>Batches Results</h3>
            <Table>
              <thead>
                <tr>
                  <Th>Job Name</Th>
                  <Th>Batch ID</Th>
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
        </>
      )}

      {errorLogs.length > 0 && (
        <TableContainer>
          <h3>Error Logs</h3>
          <Table>
            <thead>
              <tr>
                <Th>Error ID</Th>
                <Th>Job Name</Th>
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
      )}
    </div>
  );
};

export default BatchProcessor;