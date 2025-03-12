import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  MainContainer,
  SectionContainer,
  InputContainer,
  InputLabel,
  Button,
  ReadOnlyInput,
} from "./BatchProcessorStyles";
// import BatchDashboard from "./BatchDashboard";
import ConfigPanel from "./ConfigPanel";
import JobProgressTracker from "./JobProgressTracker";
//---------------------------------------------

interface JobType {
  JobTypeID: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
}

interface JobRequest {
  recordCount: number;
  startRow: number;
  tableName: string;
  priorityScreenName: string;
  jobType: string;
}

const BatchProcessor: React.FC = () => {
  const [recordCount, setRecordCount] = useState(100);
  const [startRow, setStartRow] = useState(1);
  const [tableName, setTableName] = useState("");
  const [priorityScreenName, setPriorityScreenName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [selectedJobType, setSelectedJobType] = useState("");
  //---------------------------------------------

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

  //---------------------------------------------
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
    if (!tableName || !priorityScreenName) {
      toast.error("Table Name and Priority Screen Name are required.");
      return;
    }

    setIsProcessing(true);

    try {
      await axios.post("http://localhost:3001/job/run-job", {
        recordCount,
        startRow,
        tableName,
        priorityScreenName,
        jobType: selectedJobType,
      });
    } catch (error) {
      console.error("Batch process error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([]);
  const [jobRequests, setJobRequests] = useState<JobRequest[]>([]);

  const handleMultipleJobTypeChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedOptions = Array.from(
      e.target.selectedOptions,
      (option) => option.value
    );
    setSelectedJobTypes(selectedOptions);

    const newJobRequests = selectedOptions.map((jobType) => {
      const selectedJob = jobTypes.find((job) => job.JobTypeName === jobType);
      return {
        recordCount: 100,
        startRow: 1,
        tableName: selectedJob?.DBTableName || "",
        priorityScreenName: selectedJob?.ScreenName || "",
        jobType,
      };
    });

    setJobRequests(newJobRequests);
  };

  const handleJobRequestChange = (index: number, field: string, value: any) => {
    const newJobRequests = [...jobRequests];
    newJobRequests[index] = { ...newJobRequests[index], [field]: value };
    setJobRequests(newJobRequests);
  };

  const handleMultipleBatchProcess = async () => {
    if (jobRequests.some((job) => !job.tableName || !job.priorityScreenName)) {
      toast.error("All jobs must have Table Name and Priority Screen Name.");
      return;
    }

    setIsProcessing(true);

    try {
      await axios.post(
        "http://localhost:3001/job/run-multiple-jobs",
        jobRequests
      );
    } catch (error) {
      console.error("Batch process error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <ToastContainer />
      <MainContainer>
        <SectionContainer>
          <ConfigPanel />
        </SectionContainer>
        <SectionContainer>
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
        </SectionContainer>

        <SectionContainer>
          <h2>Run Multiple Jobs</h2>
          <InputContainer>
            <InputLabel>
              Job Types:
              <select
                multiple
                value={selectedJobTypes}
                onChange={handleMultipleJobTypeChange}
              >
                <option value="">Select Job Types</option>
                {jobTypes.map((job: any) => (
                  <option key={job.JobTypeID} value={job.JobTypeName}>
                    {job.JobTypeName}
                  </option>
                ))}
              </select>
            </InputLabel>
          </InputContainer>

          {jobRequests.map((jobRequest, index) => (
            <InputContainer key={index}>
              <h3>{jobRequest.jobType}</h3>
              <InputLabel>
                Record Count:
                <input
                  type="number"
                  value={jobRequest.recordCount}
                  onChange={(e) =>
                    handleJobRequestChange(
                      index,
                      "recordCount",
                      Number(e.target.value)
                    )
                  }
                />
              </InputLabel>
              <InputLabel>
                Start Row:
                <input
                  type="number"
                  value={jobRequest.startRow}
                  onChange={(e) =>
                    handleJobRequestChange(
                      index,
                      "startRow",
                      Number(e.target.value)
                    )
                  }
                />
              </InputLabel>
              <InputLabel>
                DB Table Name:
                <ReadOnlyInput
                  type="text"
                  value={jobRequest.tableName}
                  readOnly
                />
              </InputLabel>
              <InputLabel>
                Priority Screen Name:
                <ReadOnlyInput
                  type="text"
                  value={jobRequest.priorityScreenName}
                  readOnly
                />
              </InputLabel>
            </InputContainer>
          ))}

          <Button
            onClick={handleMultipleBatchProcess}
            disabled={isProcessing}
            className={`process-button ${isProcessing ? "processing" : ""}`}
          >
            {isProcessing ? "Processing..." : "Process Multiple Jobs"}
          </Button>

          <h2>Selected Jobs</h2>
          <ul>
            {selectedJobTypes.map((jobType, index) => (
              <li key={index}>{jobType}</li>
            ))}
          </ul>
        </SectionContainer>
        <SectionContainer>
          <JobProgressTracker />
        </SectionContainer>
      </MainContainer>
    </div>
  );
};

export default BatchProcessor;
