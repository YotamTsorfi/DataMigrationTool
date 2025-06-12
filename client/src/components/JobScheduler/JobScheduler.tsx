/**
 * Job Scheduler component that executes jobs in sequence based on their RunOrder value.
 * Jobs are processed one after another, with each job completing before the next one starts.
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import JobProgressTracker from "../JobProgressTracker";
import { useAuthProtection } from "../withAuthProtection";
import {
  MainContainer,
  SectionContainer,
  ButtonGroup,
  InfoBox,
} from "../BatchProcessorStyles";
import SecureButton from "../SecureButton";
import "./JobScheduler.css";

interface JobType {
  JobTypeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  SourceSystem: string;
  priority_id: string | null;
  linkedField: string | null;
  RunOrder: number;
  status?: "pending" | "active" | "completed" | "failed";
}

interface SchedulerStatus {
  isRunning: boolean;
  schedulerJobId: string | null;
  activeJob: {
    jobId: string;
    jobTypeId: number;
    jobTypeName: string;
  } | null;
  jobQueue: Array<{
    jobTypeId: number;
    jobTypeName: string;
    status: "pending" | "active" | "completed" | "failed";
  }>;
}

const JobScheduler: React.FC = () => {
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // eslint-disable-next-line
  const [_schedulerJobId, setSchedulerJobId] = useState<string | null>(null);
  const { disabled, isAuthenticated } = useAuthProtection();

  // Memoize the fetchSchedulerStatus function to prevent unnecessary rerenders
  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/job-scheduler/status`
      );
      const status: SchedulerStatus = response.data;

      setIsRunning(status.isRunning);

      if (status.activeJob) {
        setActiveJobId(status.activeJob.jobId);
      } else {
        setActiveJobId(null);
      }

      // Update job statuses based on queue
      if (status.jobQueue) {
        setJobTypes((prev) =>
          prev.map((job) => {
            const queueItem = status.jobQueue.find(
              (item) => item.jobTypeId === job.JobTypeId
            );

            return queueItem ? { ...job, status: queueItem.status } : job;
          })
        );
      }

      // If scheduler is not running anymore and we had it as running, fetch fresh job data
      if (!status.isRunning && isRunning) {
        fetchJobTypes();
      }

      // Store scheduler job ID if available
      if (status.schedulerJobId) {
        setSchedulerJobId(status.schedulerJobId);
      }
    } catch (error) {
      console.error("Error fetching scheduler status:", error);
    }
  }, [isRunning]); // Include isRunning as a dependency

  const fetchJobTypes = async () => {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/jobtypes`
      );
      // Filter out jobs with RunOrder of 0 and sort by RunOrder
      const sortedJobs = response.data
        .filter((job: JobType) => job.RunOrder > 0)
        .sort((a: JobType, b: JobType) => a.RunOrder - b.RunOrder);

      setJobTypes(
        sortedJobs.map((job: JobType) => ({ ...job, status: "pending" }))
      );
    } catch (error) {
      console.error("Error fetching job types:", error);
      toast.error("Failed to load job types");
    }
  };

  useEffect(() => {
    fetchJobTypes();

    // Poll for status updates when running
    let intervalId: NodeJS.Timeout;
    if (isRunning) {
      intervalId = setInterval(fetchSchedulerStatus, 2000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRunning, fetchSchedulerStatus]); // Added fetchSchedulerStatus as dependency

  const startJobSequence = async () => {
    if (!isAuthenticated) {
      toast.error("Please login to perform this action");
      return;
    }

    if (jobTypes.length === 0) {
      toast.warning("No jobs to process");
      return;
    }

    try {
      setIsRunning(true);

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/job-scheduler/start`
      );

      setSchedulerJobId(response.data.schedulerJobId);
      toast.success("Job sequence started successfully");

      // Immediately fetch status to get active job
      fetchSchedulerStatus();
    } catch (error) {
      console.error("Error starting job sequence:", error);
      toast.error("Failed to start job sequence");
      setIsRunning(false);
    }
  };

  return (
    <MainContainer>
      <SectionContainer>
        <h2>Scheduled Jobs</h2>
        <InfoBox>
          These jobs will run in sequence based on their Run Order. Each job
          must complete before the next one starts.
        </InfoBox>

        <table className="job-table">
          <thead>
            <tr>
              <th>Run Order</th>
              <th>Job Name</th>
              <th>Table Name</th>
              <th>Processing Method</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobTypes.map((job) => (
              <tr
                key={job.JobTypeId}
                className={job.status === "active" ? "active-job" : ""}
              >
                <td>{job.RunOrder}</td>
                <td>{job.JobTypeName}</td>
                <td>{job.DBTableName}</td>
                <td>{job.linkedField ? "Parent-Child Grid" : "Queue"}</td>
                <td className={`status-${job.status || "pending"}`}>
                  {job.status || "Pending"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionContainer>

      <ButtonGroup>
        <SecureButton
          onClick={startJobSequence}
          disabled={isRunning || disabled}
        >
          {isRunning ? "Running..." : "Execute Job Sequence"}
        </SecureButton>
      </ButtonGroup>

      {activeJobId && (
        <SectionContainer>
          <h2>Active Job Progress</h2>
          <JobProgressTracker jobId={activeJobId} />
        </SectionContainer>
      )}
    </MainContainer>
  );
};

export default JobScheduler;
