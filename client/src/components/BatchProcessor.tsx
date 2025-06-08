import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  MainContainer,
  SectionContainer,
  InputContainer,
  InputLabel,
  ReadOnlyInput,
  RadioGroup,
  RadioButton,
  WhereClauseContainer,
  WhereClauseTextarea,
  ErrorMessage,
  InfoBox,
  ButtonGroup,
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

  // New state for WHERE clause functionality
  const [customWhereClause, setCustomWhereClause] = useState<string>("");
  const [whereClauseError, setWhereClauseError] = useState<string | null>(null);
  const [baseWhereClause, setBaseWhereClause] = useState<string>("");
  const [isValidatingWhereClause, setIsValidatingWhereClause] = useState(false);
  const [isSavingWhereClause, setIsSavingWhereClause] = useState(false);
  const [processAllRecords, setProcessAllRecords] = useState(false);
  //---------------------------------------------

  const handleProcessAllRecordsChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setProcessAllRecords(e.target.checked);
  };
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
  /**
   * Clears the WHERE clause for the selected job type
   */
  const clearWhereClause = async (): Promise<void> => {
    if (!selectedJobType) {
      toast.error("Please select a job type first");
      return;
    }

    // Confirm deletion
    if (
      !window.confirm(
        `Are you sure you want to remove the WHERE clause for ${selectedJobType}?`
      )
    ) {
      return;
    }

    setIsSavingWhereClause(true);

    try {
      // Use null as a special indicator to remove the clause
      await axios.put(
        `${process.env.REACT_APP_API_URL}/where-clause/${selectedJobType}`,
        { whereClause: null }
      );

      // Clear the local state
      setCustomWhereClause("");
      setIsSavingWhereClause(false);
      toast.success(`WHERE clause for ${selectedJobType} has been removed`);
    } catch (error) {
      console.error("Error clearing WHERE clause:", error);
      toast.error("Failed to clear WHERE clause");
      setIsSavingWhereClause(false);
    }
  };
  //---------------------------------------------
  /**
   * Fetches the WHERE clause for a specific job type
   */
  const fetchWhereClause = async (jobType: string): Promise<void> => {
    if (!jobType) return;

    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/where-clause/${jobType}`
      );
      setCustomWhereClause(response.data.whereClause || "");
      setBaseWhereClause(response.data.baseWhereClause || "");
      setWhereClauseError(null);
    } catch (error) {
      console.error("Error fetching WHERE clause:", error);
      setWhereClauseError("Failed to load WHERE clause");
    }
  };

  /**
   * Validates the current WHERE clause syntax
   */
  const validateWhereClause = async (): Promise<boolean> => {
    // Empty clause is valid
    if (!customWhereClause.trim()) return true;

    setIsValidatingWhereClause(true);
    setWhereClauseError(null);

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/where-clause/validate`,
        { whereClause: customWhereClause }
      );

      setIsValidatingWhereClause(false);

      if (!response.data.valid) {
        setWhereClauseError(response.data.message);
        return false;
      }
      toast.success("WHERE clause syntax is valid");
      return true;
    } catch (error) {
      console.error("Error validating WHERE clause:", error);
      setWhereClauseError("Failed to validate WHERE clause");
      setIsValidatingWhereClause(false);
      return false;
    }
  };

  /**
   * Saves the WHERE clause for the selected job type
   */
  const saveWhereClause = async (): Promise<void> => {
    if (!selectedJobType) {
      toast.error("Please select a job type first");
      return;
    }

    // Validate before saving
    const isValid = await validateWhereClause();
    if (!isValid) return;

    setIsSavingWhereClause(true);

    try {
      const response = await axios.put(
        `${process.env.REACT_APP_API_URL}/where-clause/${selectedJobType}`,
        { whereClause: customWhereClause }
      );

      setIsSavingWhereClause(false);
      toast.success(response.data.message || "WHERE clause saved successfully");
    } catch (error) {
      console.error("Error saving WHERE clause:", error);
      toast.error("Failed to save WHERE clause");
      setIsSavingWhereClause(false);
    }
  };
  //---------------------------------------------
  const handleJobTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;
    const selectedJob = jobTypes.find(
      (job) => job.JobTypeName === selectedValue
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

    setSelectedJobType(selectedValue);

    // Fetch the WHERE clause for the selected job type
    if (selectedValue) {
      fetchWhereClause(selectedValue);
    } else {
      setCustomWhereClause("");
      setBaseWhereClause("");
    }
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

    // Validate the WHERE clause if it's provided
    if (customWhereClause.trim()) {
      const isValid = await validateWhereClause();
      if (!isValid) return;
    }

    setIsProcessing(true);

    try {
      // Use the specific endpoint for processing type and include the WHERE clause
      await axios.post(
        `${process.env.REACT_APP_API_URL}/job/start-with-type/${processingType}`,
        {
          processAllRecords,
          recordCount: processAllRecords ? -1 : recordCount,
          startRow: processAllRecords ? 1 : startRow,
          tableName,
          priorityScreenName,
          jobType: selectedJobType,
          priorityIdField,
          priorityLinkedField,
          priorityJobTypeId,
          customWhereClause: customWhereClause.trim() || undefined,
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
  //---------------------------
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
            <InputLabel style={{ display: "flex", alignItems: "center" }}>
              <br />
              Process all records:
              <input
                type="checkbox"
                checked={processAllRecords}
                onChange={handleProcessAllRecordsChange}
                style={{ marginRight: "8px" }}
              />
              <br />
            </InputLabel>
            <InputLabel>
              Record Count:
              <input
                type="number"
                value={recordCount}
                onChange={(e) => setRecordCount(Number(e.target.value))}
                disabled={processAllRecords}
              />
            </InputLabel>
            <InputLabel>
              Start Row:
              <input
                type="number"
                value={startRow}
                onChange={(e) => setStartRow(Number(e.target.value))}
                disabled={processAllRecords}
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

            {/* Custom WHERE Clause section */}
            {selectedJobType && (
              <WhereClauseContainer>
                <h3>Custom WHERE Clause</h3>
                <WhereClauseTextarea
                  value={customWhereClause}
                  onChange={(e) => setCustomWhereClause(e.target.value)}
                  placeholder="Enter custom WHERE conditions (e.g. field1 > 100 AND field2 = 'value')"
                  rows={4}
                  $hasError={!!whereClauseError}
                />
                {whereClauseError && (
                  <ErrorMessage>{whereClauseError}</ErrorMessage>
                )}
                <InfoBox>
                  <strong>Base WHERE clause:</strong>{" "}
                  <code>{baseWhereClause}</code>
                  <br />
                  Your custom clause will be combined with the base clause using
                  AND.
                  <br />
                  Do not include the "WHERE" keyword.
                </InfoBox>
                <ButtonGroup>
                  <SecureButton
                    onClick={saveWhereClause}
                    disabled={
                      isSavingWhereClause || isValidatingWhereClause || disabled
                    }
                  >
                    {isSavingWhereClause ? "Saving..." : "Save WHERE Clause"}
                  </SecureButton>
                  <SecureButton
                    onClick={validateWhereClause}
                    disabled={isValidatingWhereClause || disabled}
                  >
                    {isValidatingWhereClause
                      ? "Validating..."
                      : "Validate Syntax"}
                  </SecureButton>
                  <SecureButton
                    onClick={clearWhereClause}
                    disabled={isSavingWhereClause || disabled}
                    style={disabled ? {} : { backgroundColor: "#dc3545" }}
                  >
                    Clear WHERE Clause
                  </SecureButton>
                </ButtonGroup>
              </WhereClauseContainer>
            )}
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
