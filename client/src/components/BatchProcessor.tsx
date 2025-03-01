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

    const handleBatchProcess = async () => {
      setIsProcessing(true);
      setResults([]);

      try {
        const response = await axios.post<BatchResponse[]>(
          // 'http://localhost:3001/api/batch/process' // One File
          "http://localhost:3001/api/batch/process-files" // Multiple Files
        );
        console.log("Batch process response:", response.data);
        setResults(response.data);
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

        <button
          onClick={handleBatchProcess}
          disabled={isProcessing}
          className={`process-button ${isProcessing ? "processing" : ""}`}
        >
          {isProcessing ? "Processing..." : "Process Batch"}
        </button>

        {results.length > 0 && (
          <div className="results">
            {results.map((result, index) => (
              <div
                key={index}
                className={`result ${result.success ? "success" : "error"}`}
              >
                {result.success ? (
                  <>
                    <h3>Success!</h3>
                    <p>Processed {result.vehiclesCount} vehicles</p>
                    <p>{result.message}</p>
                    <p>Request Size: {result.requestSize} bytes</p>
                    <p>Response Size: {result.responseSize} bytes</p>
                    <p>Duration: {result.duration} ms</p>
                    <p>
                      Average Time Per Record: {result.averageTimePerRecord}
                    </p>
                  </>
                ) : (
                  <>
                    <h3>Error</h3>
                    <p>{result.error}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
};

export default BatchProcessor;