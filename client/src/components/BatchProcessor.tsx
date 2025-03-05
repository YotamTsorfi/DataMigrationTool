// client/src/components/BatchProcessor.tsx
import React, { useState } from 'react';
import axios from 'axios';
import {
  Container,
  InputContainer,
  InputLabel,
  Button,
  TableContainer,
  Table,
  Th,
  Td,
  FlexContainer, // Import the new styled component
} from "./BatchProcessorStyles";
import BatchDashboard from "./BatchDashboard";

interface BatchResponse {
  success: boolean;
  status?: number;
  vehiclesCount?: number;
  message?: string;
  error?: string;
  requestSize?: number;
  responseSize?: number;
  duration?: number;
  averageTimePerRecord?: string;
}

const BatchProcessor: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<BatchResponse[]>([]);
  const [recordCount, setRecordCount] = useState(200);
  const [startRow, setStartRow] = useState(401);
  const [batchResults, setBatchResults] = useState([]);
  const [failedVehicles, setFailedVehicles] = useState([]);

  const handleBatchProcess = async () => {
    setIsProcessing(true);
    setResults([]);

    try {
      await axios.post("http://localhost:3001/api/batch/run-job", {
        recordCount,
        startRow,
      });
      const response = await axios.get(
        "http://localhost:3001/api/batch/results"
      );
      setBatchResults(response.data.batchResults);
      setFailedVehicles(response.data.failedVehicles);
    } catch (error) {
      console.error("Batch process error:", error);
      setResults([
        {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to process batch",
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="batch-processor">
      <h2>Priority Vehicles Batch Processor</h2>

      <Container>
        <FlexContainer>
          <InputContainer>
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
          </InputContainer>

          <Button
            onClick={handleBatchProcess}
            disabled={isProcessing}
            className={`process-button ${isProcessing ? "processing" : ""}`}
          >
            {isProcessing ? "Processing..." : "Process Batch"}
          </Button>
        </FlexContainer>
      </Container>

      {batchResults.length > 0 && (
        <>
          <BatchDashboard batchResults={batchResults} />
          <TableContainer>
            <h3>Batch Results</h3>
            <Table>
              <thead>
                <tr>
                  <Th>Batch ID</Th>
                  <Th>Start Time</Th>
                  <Th>End Time</Th>
                  <Th>Total Records</Th>
                  <Th>Success Count</Th>
                  <Th>Failure Count</Th>
                  <Th>Status</Th>
                  <Th>Error Message</Th>
                </tr>
              </thead>
              <tbody>
                {batchResults.map((result: any, index: number) => (
                  <tr key={index}>
                    <Td>{result.BatchID}</Td>
                    <Td>{result.StartTime}</Td>
                    <Td>{result.EndTime}</Td>
                    <Td>{result.TotalRecords}</Td>
                    <Td>{result.SuccessCount}</Td>
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