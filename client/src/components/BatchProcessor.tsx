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
  RadioGroup,
  RadioButton,
} from "./BatchProcessorStyles";
import ConfigPanel from "./ConfigPanel";
import JobProgressTracker from "./JobProgressTracker";
import SecureButton from "./SecureButton";
import { useAuthProtection } from "./withAuthProtection";
//---------------------------------------------

interface JobType {
  JobTypeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string;
  linkedField: string;
}

interface ConfigItem {
  ConfigKey: string;
  ConfigValue: string;
  Description?: string;
}

const BatchProcessor: React.FC = () => {
  const [recordCount, setRecordCount] = useState(100);
  const [startRow, setStartRow] = useState(1);
  const [tableName, setTableName] = useState("");
  const [priorityScreenName, setPriorityScreenName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobTypes, setJobTypes] = useState<JobType[]>([]);
  const [selectedJobType, setSelectedJobType] = useState("");
  const [processingType, setProcessingType] = useState<string>("batch");
  const [priorityIdField, setPriorityIdField] = useState("");
  const [priorityLinkedField, setPriorityLinkedField] = useState("");
  const [priorityJobTypeId, setPriorityJobTypeId] = useState(0);
  const { disabled, isAuthenticated } = useAuthProtection();
  //---------------------------------------------

  useEffect(() => {
    const fetchJobTypes = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/job/job-types`
        );
        setJobTypes(response.data);
      } catch (error) {
        console.error("Error fetching job types:", error);
      }
    };

    const fetchProcessingType = async () => {
      try {
        // Only fetch the processing type config instead of all configs
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/config`
        );
        const defaultProcessingType = response.data.find(
          (item: ConfigItem) => item.ConfigKey === "PROCESSING_TYPE"
        );
        if (defaultProcessingType) {
          setProcessingType(defaultProcessingType.ConfigValue.toLowerCase());
        }
      } catch (error) {
        console.error("Error fetching processing type:", error);
      }
    };

    fetchJobTypes();
    fetchProcessingType();
  }, []);
  //---------------------------------------------
  // const refreshSystemConfig = async () => {
  //   try {
  //     const response = await axios.get(`${process.env.REACT_APP_API_URL}/job/config`);
  //     if (response.data.success && response.data.config) {
  //       setSystemConfig(response.data.config);
  //     }
  //   } catch (error) {
  //     console.error("Error refreshing system configuration:", error);
  //   }
  // };
  //---------------------------------------------
  const handleJobTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedJob = jobTypes.find(
      (job) => job.JobTypeName === e.target.value
    );
    if (selectedJob) {
      setTableName(selectedJob.DBTableName || "");
      setPriorityScreenName(selectedJob.ScreenName || "");
      setPriorityIdField(selectedJob.priority_id || "");
      setPriorityLinkedField(selectedJob.linkedField || "");
      setPriorityJobTypeId(selectedJob.JobTypeId || 0);
    } else {
      setTableName("");
      setPriorityScreenName("");
      setPriorityIdField("");
      setPriorityLinkedField("");
      setPriorityJobTypeId(0);
    }
    setSelectedJobType(e.target.value);
  };
  //---------------------------------------------
  const handleProcessingTypeChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setProcessingType(e.target.value);
  };
  //---------------------------------------------
  const handleBatchProcess = async () => {
    // Check authentication before processing
    if (!isAuthenticated) {
      toast.error("Please login to perform this action");
      return;
    }
    if (!tableName || !priorityScreenName || !priorityIdField) {
      toast.error(
        "Table Name and Priority Screen Name and priority Id Field are required."
      );
      return;
    }
    setIsProcessing(true);

    try {
      // Use the specific endpoint for processing type
      await axios.post(
        `${process.env.REACT_APP_API_URL}/job/start-with-type/${processingType}`,
        {
          recordCount,
          startRow,
          tableName,
          priorityScreenName,
          jobType: selectedJobType,
          priorityIdField,
          priorityLinkedField,
          priorityJobTypeId,
        }
      );

      // toast.success(`Job started using ${processingType} processing`);
    } catch (error) {
      console.error("Batch process error:", error);
      toast.error(
        `Failed to start job: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsProcessing(false);
    }
  };
  //---------------------------------------------
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
            <h3>Processing Type</h3>
            <RadioGroup>
              <RadioButton>
                <input
                  type="radio"
                  name="processingType"
                  value="batch"
                  checked={processingType.toLowerCase() === "batch"}
                  onChange={handleProcessingTypeChange}
                  disabled={disabled}
                />
                <label>Batch Processing</label>
                <div className="info-tooltip">
                  Creates batches of records and processes them in parallel
                </div>
              </RadioButton>
              <RadioButton>
                <input
                  type="radio"
                  name="processingType"
                  value="queue"
                  checked={processingType.toLowerCase() === "queue"}
                  onChange={handleProcessingTypeChange}
                />
                <label>Queue Processing (Grid Model)</label>
                <div className="info-tooltip">
                  Grid-based processing with horizontal (parallel) and vertical
                  (sequential) batches
                </div>
              </RadioButton>
            </RadioGroup>
          </InputContainer>

          <InputContainer>
            <InputLabel>
              Job Type:
              <select value={selectedJobType} onChange={handleJobTypeChange}>
                <option value="">Select Job Type</option>
                {jobTypes.map((job: any) => (
                  <option key={job.JobTypeId} value={job.JobTypeName}>
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
            <InputLabel>
              Priority ID Field:
              <ReadOnlyInput
                type="text"
                value={priorityIdField}
                onChange={(e) => setPriorityIdField(e.target.value)}
                readOnly
              />
            </InputLabel>
            <InputLabel>
              Priority Linked Field:
              <ReadOnlyInput
                type="text"
                value={priorityLinkedField}
                onChange={(e) => setPriorityLinkedField(e.target.value)}
                readOnly
              />
            </InputLabel>
          </InputContainer>

          <SecureButton
            onClick={handleBatchProcess}
            disabled={isProcessing || disabled}
            className={`process-button ${isProcessing ? "processing" : ""}`}
          >
            {isProcessing
              ? "Processing..."
              : `Process with ${processingType.charAt(0).toUpperCase() + processingType.slice(1)}`}
          </SecureButton>
        </SectionContainer>

        <SectionContainer>
          <JobProgressTracker />
        </SectionContainer>
      </MainContainer>
    </div>
  );
};

export default BatchProcessor;
