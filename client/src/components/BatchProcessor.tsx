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
  Table,
  Th,
  Td,
  TableContainer,
} from "./BatchProcessorStyles";
import JobProgressTracker from "./JobProgressTracker";
import SecureButton from "./SecureButton";
import { useAuthProtection } from "./withAuthProtection";
import { fetchChildJobs as fetchChildJobsFromService } from "../services/jobTypesService";
import { IChildJob } from "./JobTypesManager/JobTypesManager";
import CaseIdSelector from "./CaseIdSelector";
//---------------------------------------------

interface JobType {
  JobTypeId: number;
  JobTypeName: string;
  DBTableName: string;
  ScreenName: string;
  priority_id: string;
  linkedField: string;
  HebrewName?: string;
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

  // State for WHERE clause functionality
  const [customWhereClause, setCustomWhereClause] = useState<string>("");
  const [whereClauseError, setWhereClauseError] = useState<string | null>(null);
  const [baseWhereClause, setBaseWhereClause] = useState<string>("");
  const [isValidatingWhereClause, setIsValidatingWhereClause] = useState(false);
  const [isSavingWhereClause, setIsSavingWhereClause] = useState(false);
  const [processAllRecords, setProcessAllRecords] = useState(false);

  // State for child jobs
  const [childJobs, setChildJobs] = useState<IChildJob[]>([]);
  const [isLoadingChildJobs, setIsLoadingChildJobs] = useState(false);

  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
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
  const fetchChildJobs = async (jobTypeId: number): Promise<void> => {
    if (!jobTypeId) return;

    setIsLoadingChildJobs(true);
    try {
      const data = await fetchChildJobsFromService(jobTypeId);
      setChildJobs(data);
    } catch (error) {
      console.error("Error fetching child jobs:", error);
      toast.error("Failed to load child jobs");
      setChildJobs([]);
    } finally {
      setIsLoadingChildJobs(false);
    }
  };
  //---------------------------------------------
  /**
   * Determines if the selected job type is a delta job based on its name
   * @returns boolean indicating if the current job is a delta job
   */
  const isDeltaJob = (): boolean => {
    return selectedJobType.toLowerCase().includes("delta");
  };

  /**
   * Validates case ID for delta jobs to ensure it contains 'delta'
   * @returns boolean indicating if the case ID is valid for the job type
   */
  const isValidCaseId = (): boolean => {
    if (isDeltaJob()) {
      return selectedCaseId.toLowerCase().includes("delta");
    }
    return true; // Non-delta jobs don't have special case ID requirements
  };
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

      // Fetch child jobs when a job type is selected
      fetchChildJobs(selectedJob.JobTypeId);
    } else {
      setTableName("");
      setPriorityScreenName("");
      setPriorityIdField("");
      setPriorityLinkedField("");
      setPriorityJobTypeId(0);
      setChildJobs([]);
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

    // For delta jobs, validate that the case ID contains 'delta'
    if (isDeltaJob() && !isValidCaseId()) {
      toast.error("Delta jobs require a case ID that includes 'delta'");
      return;
    }

    setIsProcessing(true);

    try {
      // Determine which endpoint to use based on job type
      const endpoint = isDeltaJob()
        ? `${process.env.REACT_APP_API_URL}/job/start-delta-job/${processingType}`
        : `${process.env.REACT_APP_API_URL}/job/start-with-type/${processingType}`;

      // Prepare request payload
      const payload = {
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
        caseId: selectedCaseId,
      };

      await axios.post(endpoint, payload);

      // Show appropriate success message based on job type
      toast.success(
        isDeltaJob()
          ? `Delta job started with ${processingType} processing`
          : `Job started with ${processingType} processing`
      );
    } catch (error) {
      console.error("Process error:", error);

      // Extract and display error message
      let errorMessage = "Unknown error occurred";
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      toast.error(`Failed to start job: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };
  //---------------------------
  return (
    <div>
      <ToastContainer />
      <MainContainer
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <SectionContainer
          style={{
            width: "calc(50% - 10px)",
            margin: "0",
            boxSizing: "border-box",
          }}
        >
          <h2>Batch/Queue Processor</h2>

          <InputContainer>
            <RadioGroup>
              <h3>Processing Type</h3>
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

          {/* Split InputContainer into two columns for side-by-side layout */}
          <div style={{ display: "flex", flexDirection: "row", gap: "20px" }}>
            {/* Left column - Original inputs */}
            <InputContainer style={{ flex: 0.4 }}>
              <InputLabel>
                Job Type:
                <select
                  value={selectedJobType}
                  onChange={handleJobTypeChange}
                  style={{ direction: "rtl" }} // Ensure base direction is left-to-right
                >
                  <option value="">Select Job Type</option>
                  {jobTypes.map((job: JobType) => (
                    <option key={job.JobTypeId} value={job.JobTypeName}>
                      {job.JobTypeName}{" "}
                      {job.HebrewName ? `- ${job.HebrewName}` : ""}
                    </option>
                  ))}
                </select>
                {isDeltaJob() && (
                  <InfoBox
                    style={{
                      marginTop: "10px",
                      backgroundColor: "#e8f4fd",
                      borderColor: "#4dabf7",
                    }}
                  >
                    <strong>Delta Job Selected</strong>
                    <p>
                      This is a delta job that processes only new or modified
                      records.
                      {selectedJobType.toLowerCase().includes("child") &&
                        " This job includes parent-child relationships."}
                    </p>
                    <p>
                      <strong>Important:</strong> Delta jobs require a case ID
                      that contains 'delta'.
                    </p>
                  </InfoBox>
                )}
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
                Case ID:
                <CaseIdSelector
                  onCaseIdSelect={setSelectedCaseId}
                  selectedCaseId={selectedCaseId}
                />
              </InputLabel>
              <br />
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
            </InputContainer>

            {/* Right column - Child jobs display */}
            <InputContainer style={{ flex: 0.6 }}>
              <h3>Child Jobs</h3>
              {isLoadingChildJobs ? (
                <p>Loading child jobs...</p>
              ) : Array.isArray(childJobs) && childJobs.length > 0 ? (
                <TableContainer>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Job Type Name</Th>
                        <Th>DB Table</Th>
                        <Th>Screen Name</Th>
                        <Th>Has Siblings</Th>
                        <Th>Priority ID</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {childJobs.map((childJob) => (
                        <tr
                          key={childJob.ChildJobeId || `child-${Math.random()}`}
                        >
                          <Td>{childJob.JobTypeName}</Td>
                          <Td>{childJob.DBTableName}</Td>
                          <Td>{childJob.ScreenName}</Td>
                          <Td>{childJob.HasSiblings ? "Yes" : "No"}</Td>
                          <Td>{childJob.priority_id || "-"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableContainer>
              ) : selectedJobType ? (
                <p>No child jobs found for this job type.</p>
              ) : (
                <p>Select a job type to view child jobs.</p>
              )}
            </InputContainer>
          </div>

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

          <SecureButton
            onClick={handleBatchProcess}
            disabled={isProcessing || disabled}
            className={`process-button ${isProcessing ? "processing" : ""}`}
          >
            {isProcessing
              ? "Processing..."
              : isDeltaJob()
                ? `Process Delta with ${processingType.charAt(0).toUpperCase() + processingType.slice(1)}`
                : `Process with ${processingType.charAt(0).toUpperCase() + processingType.slice(1)}`}
          </SecureButton>
        </SectionContainer>

        <SectionContainer
          style={{
            width: "calc(50% - 10px)",
            margin: "0",
            boxSizing: "border-box",
          }}
        >
          <JobProgressTracker />
        </SectionContainer>
      </MainContainer>
    </div>
  );
};

export default BatchProcessor;
