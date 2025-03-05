// client/src/components/BatchProcessor.tsx
import React, { useState } from 'react';
import axios from 'axios';

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
              error instanceof Error
                ? error.message
                : "Failed to process batch",
          },
        ]);
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <div className="batch-processor">
        <h2>Priority Vehicles Batch Processor</h2>

        <div>
          <label>
            Record Count:
            <input
              type="number"
              value={recordCount}
              onChange={(e) => setRecordCount(Number(e.target.value))}
            />
          </label>
          <label>
            Start Row:
            <input
              type="number"
              value={startRow}
              onChange={(e) => setStartRow(Number(e.target.value))}
            />
          </label>
        </div>

        <button
          onClick={handleBatchProcess}
          disabled={isProcessing}
          className={`process-button ${isProcessing ? "processing" : ""}`}
        >
          {isProcessing ? "Processing..." : "Process Batch"}
        </button>

        {batchResults.length > 0 && (
          <div className="results">
            <h3>Batch Results</h3>
            {batchResults.map((result: any, index: number) => (
              <div key={index} className="result">
                <p>Batch ID: {result.BatchID}</p>
                <p>Start Time: {result.StartTime}</p>
                <p>End Time: {result.EndTime}</p>
                <p>Total Records: {result.TotalRecords}</p>
                <p>Success Count: {result.SuccessCount}</p>
                <p>Failure Count: {result.FailureCount}</p>
                <p>Status: {result.Status}</p>
                <p>Error Message: {result.ErrorMessage}</p>
              </div>
            ))}
          </div>
        )}

        {failedVehicles.length > 0 && (
          <div className="results">
            <h3>Failed Vehicles</h3>
            {failedVehicles.map((vehicle: any, index: number) => (
              <div key={index} className="result error">
                <p>Row ID: {vehicle.RowId}</p>
                <p>Error: {vehicle.Error}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
};

export default BatchProcessor;