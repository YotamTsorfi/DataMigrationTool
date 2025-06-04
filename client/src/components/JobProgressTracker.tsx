import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import { styled } from "styled-components";
import CancelJobButton from "./CancelJobButton";
import CancellationStatus from "./CancellationStatus";

// Progress bar styled components
const ProgressContainer = styled.div`
  margin: 20px 0;
  width: 100%;
`;

const ProgressBarOuter = styled.div`
  height: 20px;
  width: 100%;
  background-color: #e0e0e0;
  border-radius: 10px;
  margin: 10px 0;
`;

const ProgressBarInner = styled.div<{ width: number; $status: string }>`
  height: 100%;
  width: ${(props) => props.width}%;
  background-color: ${(props) =>
    props.$status === "completed"
      ? "#4caf50"
      : props.$status === "failed"
        ? "#f44336"
        : "#2196f3"};
  border-radius: 10px;
  transition: width 0.3s ease;
`;

const ProgressDetails = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 14px;
`;

const JobInfo = styled.div`
  padding: 15px;
  margin-bottom: 10px;
  border-radius: 8px;
  background-color: #f5f5f5;
`;

const ActionContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
`;

// Types
interface JobProgress {
  jobId: string;
  jobName: string;
  totalRecords: number;
  processedRecords: number;
  successCount: number;
  failureCount: number;
  percentage: number;
  status: "pending" | "processing" | "completed" | "failed" | "Cancelling";
  lastUpdated?: number;
}

interface JobProgressTrackerProps {
  jobId?: string; // Optional - if provided, will only track this job
}

const JobProgressTracker: React.FC<JobProgressTrackerProps> = ({ jobId }) => {
  const [activeJobs, setActiveJobs] = useState<JobProgress[]>([]);

  // Handle successful job cancellation
  const handleCancelSuccess = (cancelledJobId: string): void => {
    setActiveJobs((prev) =>
      prev.map((job) =>
        job.jobId === cancelledJobId ? { ...job, status: "Cancelling" } : job
      )
    );
  };

  useEffect(() => {
    // Connect to socket server
    const socketClient = io(process.env.REACT_APP_API_URL);

    // Listen for progress updates
    socketClient.on("job:progress", (progressData: JobProgress) => {
      if (jobId && progressData.jobId !== jobId) return;

      setActiveJobs((prev) => {
        const existingJobIndex = prev.findIndex(
          (job) => job.jobId === progressData.jobId
        );

        if (existingJobIndex >= 0) {
          const updatedJobs = [...prev];
          updatedJobs[existingJobIndex] = progressData;
          return updatedJobs;
        } else {
          // Add new jobs at the beginning of the array instead of the end
          return [progressData, ...prev];
        }
      });
    });

    // Initial fetch of active jobs
    if (!jobId) {
      fetch(`${process.env.REACT_APP_API_URL}/job/active-jobs`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.activeJobs) {
            // Sort active jobs to ensure newest ones are at the top
            const sortedJobs = [...data.activeJobs].sort(
              (a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0)
            );
            setActiveJobs(sortedJobs);
          }
        })
        .catch((err) => console.error("Error fetching active jobs:", err));
    } else {
      fetch(`${process.env.REACT_APP_API_URL}/job/progress/${jobId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.progress) {
            setActiveJobs([data.progress]);
          }
        })
        .catch((err) =>
          console.error(`Error fetching job progress for ${jobId}:`, err)
        );
    }

    // Cleanup
    return () => {
      socketClient.disconnect();
    };
  }, [jobId]);

  // Filter completed jobs after a delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveJobs((prev) =>
        prev.filter(
          (job) =>
            job.status === "pending" ||
            job.status === "processing" ||
            Date.now() - (job.lastUpdated || 0) < 60000
        )
      );
    }, 60000);

    return () => clearTimeout(timer);
  }, [activeJobs]);

  return (
    <div>
      <h3>Job Progress</h3>
      {activeJobs.length === 0 ? (
        <p>No active jobs</p>
      ) : (
        activeJobs.map((job) => {
          // Determine if the job can be cancelled
          const isCancellable = ["pending", "processing"].includes(job.status);
          const isCancelling = job.status === "Cancelling";

          return (
            <JobInfo key={job.jobId}>
              {job.jobName && <h3>{job.jobName}</h3>}
              <h4>Job: {job.jobId}</h4>
              <ProgressContainer>
                <ProgressDetails>
                  <span>Progress: {job.percentage}%</span>
                  <span>
                    {job.processedRecords} / {job.totalRecords} records
                  </span>
                </ProgressDetails>
                <ProgressBarOuter>
                  <ProgressBarInner
                    width={job.percentage}
                    $status={job.status}
                  />
                </ProgressBarOuter>
                <ProgressDetails>
                  <span>Status: {job.status}</span>
                  <span>
                    Success: {job.successCount} | Failures: {job.failureCount}
                  </span>
                </ProgressDetails>
              </ProgressContainer>

              {/* Display cancellation status when job is being cancelled */}
              {isCancelling && <CancellationStatus jobId={job.jobId} />}

              {/* Cancel button for in-progress jobs */}
              <ActionContainer>
                <CancelJobButton
                  jobId={job.jobId}
                  disabled={!isCancellable}
                  onSuccess={() => handleCancelSuccess(job.jobId)}
                  buttonText="Cancel Job"
                  className={isCancellable ? "active" : "disabled"}
                  jobStatus={job.status} // Pass the job status here
                />
              </ActionContainer>
            </JobInfo>
          );
        })
      )}
    </div>
  );
};

export default JobProgressTracker;
