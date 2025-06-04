/**
 * Component that displays detailed cancellation status information
 * Provides visual feedback about the cancellation process
 */
import React, { useState, useEffect } from "react";
import styled from "styled-components";

const CancellationContainer = styled.div`
  background-color: #fff3cd;
  border: 1px solid #ffeeba;
  border-radius: 4px;
  padding: 12px 16px;
  margin: 15px 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Spinner = styled.div`
  border: 2px solid #f3f3f3;
  border-top: 2px solid #ffc107;
  border-radius: 50%;
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
  flex-shrink: 0;

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

const MessageText = styled.span`
  font-size: 14px;
  color: #856404;
`;

const StatusDetail = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #856404;
  font-style: italic;
`;

interface CancellationStatusProps {
  jobId: string;
}

const CancellationStatus: React.FC<CancellationStatusProps> = ({ jobId }) => {
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // Track elapsed time since cancellation was requested
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <CancellationContainer>
      <Spinner />
      <div>
        <MessageText>
          Cancellation in progress. Current operations will complete before the
          job stops. This may take a few moments depending on the job size.
        </MessageText>
        <StatusDetail>
          {elapsedTime < 30
            ? "Processing is stopping..."
            : elapsedTime < 60
              ? "Finishing current operations... This might take a bit longer for large jobs."
              : "Large job cancellation in progress. System is completing essential operations before stopping."}
        </StatusDetail>
      </div>
    </CancellationContainer>
  );
};

export default CancellationStatus;
