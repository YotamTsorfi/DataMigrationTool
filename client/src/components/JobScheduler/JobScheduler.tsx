/**
 * JobScheduler component that manages sequential job processing with pause/resume capabilities.
 * Provides real-time status updates, resilient operation recovery, and a user-friendly
 * interface for controlling job execution flow.
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import JobProgressTracker from "../JobProgressTracker";
import { useAuthProtection } from "../withAuthProtection";
import CaseIdSelector from "../CaseIdSelector";
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
  isReady?: boolean;
  hasDependency?: boolean;
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
  caseId?: string;
}

// Define job scheduler states for clarity
enum JobSchedulerState {
  IDLE = "idle",
  RUNNING = "running",
  PAUSING = "pausing",
  PAUSED = "paused",
}

const JobScheduler: React.FC = () => {
  // Use a single state to track the scheduler's current state
  const [schedulerState, setSchedulerState] = useState<JobSchedulerState>(
    JobSchedulerState.IDLE
  );
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_schedulerJobId, setSchedulerJobId] = useState<string | null>(null);
  const [lastActiveJob, setLastActiveJob] = useState<string | null>(null);
  const { disabled, isAuthenticated } = useAuthProtection();
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");

  // Define fetchJobTypes first, wrapped in its own useCallback
  const fetchJobTypes = useCallback(async (): Promise<void> => {
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
  }, []);

  // Memoize the fetchSchedulerStatus function with fetchJobTypes as dependency
  const fetchSchedulerStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/job-scheduler/status`
      );
      const status: SchedulerStatus = response.data;

      // If the status includes a caseId and we don't have one selected, use it
      if (status.caseId && !selectedCaseId) {
        setSelectedCaseId(status.caseId);
      }

      // Track the last active job ID for comparing state changes
      const currentActiveJobId = status.activeJob?.jobId || null;

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

      // Update active job information
      if (status.activeJob) {
        setActiveJobId(currentActiveJobId);
      } else {
        setActiveJobId(null);
      }

      // Store scheduler job ID if available
      if (status.schedulerJobId) {
        setSchedulerJobId(status.schedulerJobId);
      }

      // Handle state transitions based on server status and current state
      switch (schedulerState) {
        case JobSchedulerState.PAUSING:
          // Only transition to PAUSED when the job is confirmed to be not running
          // AND we have a scheduler job ID AND the active job has changed or disappeared
          if (
            !status.isRunning &&
            status.schedulerJobId &&
            (lastActiveJob !== currentActiveJobId ||
              currentActiveJobId === null)
          ) {
            console.log("Pause confirmed: Job has stopped running");
            setSchedulerState(JobSchedulerState.PAUSED);
            toast.success("Job sequence paused successfully");

            // If the job completely finished while pausing, refresh job types
            if (!status.schedulerJobId) {
              fetchJobTypes();
            }
          }
          break;

        case JobSchedulerState.RUNNING:
          // If server shows not running but we think we're running,
          // either job completed or there was an error
          if (!status.isRunning) {
            setSchedulerState(JobSchedulerState.IDLE);
            fetchJobTypes();
          }
          break;

        case JobSchedulerState.PAUSED:
          // If server shows running but we're in paused state,
          // someone else might have resumed the job
          if (status.isRunning) {
            setSchedulerState(JobSchedulerState.RUNNING);
          }
          break;

        case JobSchedulerState.IDLE:
          // If server shows running but we're idle, update to running
          if (status.isRunning) {
            setSchedulerState(JobSchedulerState.RUNNING);
          }
          break;
      }

      // Update the last active job ID for comparison in next poll
      setLastActiveJob(currentActiveJobId);
    } catch (error) {
      console.error("Error fetching scheduler status:", error);
    }
  }, [schedulerState, fetchJobTypes, lastActiveJob, selectedCaseId]);

  const pauseJobScheduler = async (): Promise<void> => {
    try {
      // Set state to pausing to prevent further interactions
      setSchedulerState(JobSchedulerState.PAUSING);

      toast.info(
        "Job sequence pause requested. Processing will stop shortly..."
      );

      // Send the pause request to the server
      await axios.post(
        `${process.env.REACT_APP_API_URL}/api/job-scheduler/stop`
      );

      // The fetchSchedulerStatus will handle the transition to PAUSED
      // when it detects the job is truly stopped
    } catch (error) {
      console.error("Error pausing job sequence:", error);
      toast.error("Failed to pause job sequence");

      // Revert to running state if pause request failed
      setSchedulerState(JobSchedulerState.RUNNING);
    }
  };

  const resumeJobScheduler = async (): Promise<void> => {
    try {
      // Only proceed if we're in the fully paused state
      if (schedulerState !== JobSchedulerState.PAUSED) {
        console.log("Cannot resume - scheduler not in paused state");
        return;
      }

      // Set to running first to prevent multiple clicks
      setSchedulerState(JobSchedulerState.RUNNING);

      await axios.post(
        `${process.env.REACT_APP_API_URL}/api/job-scheduler/resume`,
        { caseId: selectedCaseId }
      );

      toast.success("Job sequence resumed successfully");

      // Fetch updated status immediately
      await fetchSchedulerStatus();
    } catch (error) {
      console.error("Error resuming job sequence:", error);
      toast.error("Failed to resume job sequence");

      // Revert to paused state if resume failed
      setSchedulerState(JobSchedulerState.PAUSED);
    }
  };

  useEffect(() => {
    // Initial data loading
    fetchJobTypes();
    fetchSchedulerStatus();

    // Poll for status updates when in non-idle states
    let intervalId: NodeJS.Timeout;
    if (schedulerState !== JobSchedulerState.IDLE) {
      intervalId = setInterval(
        fetchSchedulerStatus,
        // Poll more frequently during transitions
        schedulerState === JobSchedulerState.PAUSING ? 500 : 2000
      );
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [schedulerState, fetchSchedulerStatus, fetchJobTypes]);

  const startJobSequence = async (): Promise<void> => {
    if (!isAuthenticated) {
      toast.error("Please login to perform this action");
      return;
    }

    if (jobTypes.length === 0) {
      toast.warning("No jobs to process");
      return;
    }

    try {
      // Update state immediately for UI responsiveness
      setSchedulerState(JobSchedulerState.RUNNING);

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/job-scheduler/start`,
        { caseId: selectedCaseId } // Send the selected case ID
      );

      setSchedulerJobId(response.data.schedulerJobId);
      toast.success("Job sequence started successfully");

      // Immediately fetch status to get active job
      await fetchSchedulerStatus();
    } catch (error) {
      console.error("Error starting job sequence:", error);
      toast.error("Failed to start job sequence");
      setSchedulerState(JobSchedulerState.IDLE);
    }
  };

  // Render the appropriate action button based on scheduler state
  const renderActionButton = (): React.ReactNode => {
    switch (schedulerState) {
      case JobSchedulerState.PAUSED:
        return (
          <SecureButton
            onClick={resumeJobScheduler}
            disabled={disabled}
            className="resume-button"
          >
            Resume Job Sequence
          </SecureButton>
        );

      case JobSchedulerState.RUNNING:
        return (
          <SecureButton
            onClick={pauseJobScheduler}
            disabled={disabled}
            className="pause-button"
          >
            Pause Job Sequence
          </SecureButton>
        );

      case JobSchedulerState.PAUSING:
        return (
          <SecureButton disabled={true} className="pause-button pausing">
            Pausing...
          </SecureButton>
        );

      case JobSchedulerState.IDLE:
      default:
        return (
          <SecureButton onClick={startJobSequence} disabled={disabled}>
            Execute Job Sequence
          </SecureButton>
        );
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

        <div className="case-id-selector-container">
          <label htmlFor="case-id-selector">Select Case ID:</label>
          <CaseIdSelector
            onCaseIdSelect={setSelectedCaseId}
            selectedCaseId={selectedCaseId}
          />
        </div>

        <table className="job-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Job Name</th>
              <th>Table Name</th>
              <th>Ready</th>
              <th>Dependency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobTypes.map((job) => (
              <tr key={job.JobTypeId}>
                <td>{job.RunOrder}</td>
                <td>{job.JobTypeName}</td>
                <td>{job.DBTableName}</td>
                <td>{job.isReady ? "Yes" : "No"}</td>
                <td>{job.hasDependency ? "Yes" : "No"}</td>
                <td className={`status-${job.status || "pending"}`}>
                  {job.status || "Pending"}
                </td>
              </tr>
            ))}
            {jobTypes.length === 0 && (
              <tr>
                <td colSpan={4}>No scheduled jobs found</td>
              </tr>
            )}
          </tbody>
        </table>
      </SectionContainer>

      <ButtonGroup>{renderActionButton()}</ButtonGroup>

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
