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
    const [result, setResult] = useState<BatchResponse | null>(null);

    const handleBatchProcess = async () => {
        setIsProcessing(true);
        try {
            const response = await axios.post<BatchResponse>(
                'http://localhost:3001/api/batch/process'
            );
            setResult(response.data);
        } catch (error) {
            setResult({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to process batch'
            });
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
                className={`process-button ${isProcessing ? 'processing' : ''}`}
            >
                {isProcessing ? 'Processing...' : 'Process Batch'}
            </button>

            {result && (
                <div className={`result ${result.success ? 'success' : 'error'}`}>
                    {result.success ? (
                        <>
                            <h3>Success!</h3>
                            <p>Processed {result.vehiclesCount} vehicles</p>
                            <p>{result.message}</p>
                            <p>Request Size: {result.requestSize} bytes</p>
                            <p>Response Size: {result.responseSize} bytes</p>
                            <p>Duration: {result.duration} ms</p>
                            <p>Average Time Per Record: {result.averageTimePerRecord}</p>
                        </>
                    ) : (
                        <>
                            <h3>Error</h3>
                            <p>{result.error}</p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default BatchProcessor;