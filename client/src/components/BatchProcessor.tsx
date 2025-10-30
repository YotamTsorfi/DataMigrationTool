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
  TextInput,
  SelectControl,
  CheckboxInput,
} from "./BatchProcessorStyles";
import JobProgressTracker from "./JobProgressTracker";
import ChildJobs from "./ChildJobs";
import SecureButton from "./SecureButton";
import { useAuthProtection } from "./withAuthProtection";
import { fetchChildJobs as fetchChildJobsFromService } from "../services/jobTypesService";
import { IChildJob } from "./JobTypesManager/JobTypesManager";
import CaseIdSelector from "./CaseIdSelector";

//---------------------------------------------
// Icon components using inline SVG instead of react-icons
interface IconProps {
  style?: React.CSSProperties;
}

const FaSpinner: React.FC<IconProps> = ({ style }) => (
  <svg
    style={{
      width: "16px",
      height: "16px",
      fill: "currentColor",
      ...style,
    }}
    viewBox="0 0 512 512"
  >
    <path d="M304 48C304 74.51 282.5 96 256 96C229.5 96 208 74.51 208 48C208 21.49 229.5 0 256 0C282.5 0 304 21.49 304 48zM304 464C304 490.5 282.5 512 256 512C229.5 512 208 490.5 208 464C208 437.5 229.5 416 256 416C282.5 416 304 437.5 304 464zM0 256C0 229.5 21.49 208 48 208C74.51 208 96 229.5 96 256C96 282.5 74.51 304 48 304C21.49 304 0 282.5 0 256zM512 256C512 282.5 490.5 304 464 304C437.5 304 416 282.5 416 256C416 229.5 437.5 208 464 208C490.5 208 512 229.5 512 256zM74.98 437C56.23 418.3 56.23 387.7 74.98 368.1C93.73 349.4 124.3 349.4 143 368.1C161.7 386.8 161.7 417.4 143 436.1C124.3 454.8 93.73 454.8 74.98 437zM437 74.98C418.3 56.23 418.3 25.77 437 7.029C455.7-11.68 486.3-11.68 505 7.029C523.7 25.77 523.7 56.31 505 74.98C486.3 93.65 455.7 93.65 437 74.98z" />
  </svg>
);

const FaChevronDown: React.FC<IconProps> = ({ style }) => (
  <svg
    style={{
      width: "16px",
      height: "16px",
      fill: "currentColor",
      ...style,
    }}
    viewBox="0 0 448 512"
  >
    <path d="M201.4 374.6c12.5 12.5 32.8 12.5 45.3 0l160-160c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 306.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l160 160z" />
  </svg>
);

const FaChevronUp: React.FC<IconProps> = ({ style }) => (
  <svg
    style={{
      width: "16px",
      height: "16px",
      fill: "currentColor",
      ...style,
    }}
    viewBox="0 0 448 512"
  >
    <path d="M201.4 137.4c12.5-12.5 32.8-12.5 45.3 0l160 160c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L224 205.3 86.6 342.6c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3l160-160z" />
  </svg>
);
//---------------------------------------------

interface DeltaRecordCounts {
  toAdd: number;
  toUpdate: number;
}
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

  const [deltaRecordCounts, setDeltaRecordCounts] =
    useState<DeltaRecordCounts | null>(null);
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [showDeltaCounts, setShowDeltaCounts] = useState(false);

  const [isProcessingDeltaJob, setIsProcessingDeltaJob] = useState(false);
  //---------------------------------------------

  /**
   * Fetches the counts of records to be added and updated for a delta job
   */
  const fetchDeltaRecordCounts = async (): Promise<void> => {
    if (!isDeltaJob() || !selectedCaseId || !tableName) {
      setDeltaRecordCounts(null);
      return;
    }

    setIsLoadingCounts(true);
    setDeltaRecordCounts(null);

    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/job/delta-record-counts`,
        {
          params: {
            tableName,
            caseId: selectedCaseId,
          },
        }
      );

      if (response.data.success) {
        setDeltaRecordCounts(response.data.data);
      } else {
        toast.error("Error fetching record counts: " + response.data.error);
      }
    } catch (error) {
      console.error("Error fetching delta record counts:", error);
      let errorMessage = "Failed to fetch record counts";
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      toast.error(errorMessage);
    } finally {
      setIsLoadingCounts(false);
    }
  };
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
    return isProcessingDeltaJob;
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

    // For delta jobs, validate that a case ID is provided
    if (isProcessingDeltaJob && !selectedCaseId) {
      toast.error("Delta jobs require a valid case ID");
      return;
    }

    setIsProcessing(true);

    try {
      // Determine which endpoint to use based on job type
      const endpoint = isProcessingDeltaJob
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
        isDelta: isProcessingDeltaJob,
      };

      await axios.post(endpoint, payload);

      // Show appropriate success message based on job type
      toast.success(
        isProcessingDeltaJob
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
                <SelectControl
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
                </SelectControl>
              </InputLabel>

              <InputLabel
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginTop: "10px",
                }}
              >
                Process as Delta Job:
                <CheckboxInput
                  checked={isProcessingDeltaJob}
                  onChange={(e) => setIsProcessingDeltaJob(e.target.checked)}
                  style={{ marginLeft: "10px" }}
                />
                <div className="info-tooltip">
                  Delta jobs process only new or modified records since the last
                  run
                </div>
              </InputLabel>

              {isProcessingDeltaJob && (
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

                  {selectedCaseId && (
                    <div style={{ marginTop: "10px" }}>
                      <button
                        onClick={() => {
                          setShowDeltaCounts(!showDeltaCounts);
                          if (!deltaRecordCounts && !isLoadingCounts) {
                            fetchDeltaRecordCounts();
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                          padding: "8px 12px",
                          backgroundColor: "#4dabf7",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "14px",
                          fontWeight: "bold",
                        }}
                      >
                        <span>Show Record Counts for {selectedCaseId}</span>
                        {showDeltaCounts ? <FaChevronUp /> : <FaChevronDown />}
                      </button>

                      {showDeltaCounts && (
                        <div
                          style={{
                            padding: "10px",
                            backgroundColor: "#f8f9fa",
                            borderRadius: "4px",
                            marginTop: "8px",
                            border: "1px solid #dee2e6",
                          }}
                        >
                          <h4 style={{ margin: "0 0 10px 0" }}>
                            Delta Record Counts:
                          </h4>

                          {isLoadingCounts ? (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "20px",
                              }}
                            >
                              <FaSpinner
                                style={{
                                  animation: "spin 1s linear infinite",
                                  marginRight: "10px",
                                  fontSize: "20px",
                                  color: "#4dabf7",
                                }}
                              />
                              <span>
                                Loading record counts... (may take up to 30
                                seconds)
                              </span>
                              <style>
                                {`
                        @keyframes spin {
                          0% { transform: rotate(0deg); }
                          100% { transform: rotate(360deg); }
                        }
                      `}
                              </style>
                            </div>
                          ) : deltaRecordCounts ? (
                            <div>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "8px",
                                }}
                              >
                                <div
                                  style={{
                                    padding: "10px",
                                    backgroundColor: "#e8f4fd",
                                    borderRadius: "4px",
                                    textAlign: "center",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "24px",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    {deltaRecordCounts.toAdd.toLocaleString()}
                                  </div>
                                  <div>Records to Add</div>
                                </div>
                                <div
                                  style={{
                                    padding: "10px",
                                    backgroundColor: "#e8f4fd",
                                    borderRadius: "4px",
                                    textAlign: "center",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "24px",
                                      fontWeight: "bold",
                                    }}
                                  >
                                    {deltaRecordCounts.toUpdate.toLocaleString()}
                                  </div>
                                  <div>Records to Update</div>
                                </div>
                              </div>
                              <div
                                style={{
                                  marginTop: "8px",
                                  padding: "10px",
                                  backgroundColor: "#d4edda",
                                  borderRadius: "4px",
                                  textAlign: "center",
                                  fontWeight: "bold",
                                }}
                              >
                                <span>
                                  Total Records:{" "}
                                  {(
                                    deltaRecordCounts.toAdd +
                                    deltaRecordCounts.toUpdate
                                  ).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <p>No delta records found for this case ID.</p>
                          )}

                          <button
                            onClick={fetchDeltaRecordCounts}
                            disabled={isLoadingCounts}
                            style={{
                              marginTop: "10px",
                              padding: "6px 12px",
                              backgroundColor: "#6c757d",
                              color: "white",
                              border: "none",
                              borderRadius: "4px",
                              cursor: isLoadingCounts
                                ? "not-allowed"
                                : "pointer",
                              opacity: isLoadingCounts ? 0.7 : 1,
                            }}
                          >
                            Refresh Counts
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </InfoBox>
              )}

              <InputLabel style={{ display: "flex", alignItems: "center" }}>
                <br />
                Process all records:
                <CheckboxInput
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
                <TextInput
                  type="number"
                  value={recordCount}
                  onChange={(e) => setRecordCount(Number(e.target.value))}
                  disabled={processAllRecords}
                />
              </InputLabel>
              <InputLabel>
                Start Row:
                <TextInput
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

          {/* Child jobs display (moved under WHERE Clause) */}
          <div style={{ marginTop: "20px" }}>
            <ChildJobs
              childJobs={childJobs}
              isLoading={isLoadingChildJobs}
              selectedJobType={selectedJobType}
            />
          </div>

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
