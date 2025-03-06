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
  const [failedVehicles, setFailedVehicles] = useState([]);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [selectedJobType, setSelectedJobType] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await axios.get("http://localhost:3001/job/results");
        setBatchResults(response.data.batchResults);
        setFailedVehicles(response.data.failedVehicles);
      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
    };

    fetchData();
  }, []);

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
      const response = await axios.get("http://localhost:3001/job/results");
      setBatchResults(response.data.batchResults);
      setFailedVehicles(response.data.failedVehicles);
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
      {failedVehicles.length > 0 && (
        <TableContainer>
          <h3>Failed Vehicles</h3>
          <Table>
            <thead>
              <tr>
                <Th>Row ID</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody>
              {failedVehicles.map((vehicle: any, index: number) => (
                <tr key={index}>
                  <Td>{vehicle.RowId}</Td>
                  <Td>{vehicle.Error}</Td>
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