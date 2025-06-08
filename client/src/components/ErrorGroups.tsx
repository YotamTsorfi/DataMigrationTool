import React, { useState, useEffect } from "react";
import axios from "axios";
import styled from "styled-components";
import {
  FilterContainer,
  FilterItem,
  DataTable,
  LoadingOverlay,
} from "../styles/BatchDashboardStyles";

// Styled components specific to ErrorGroups
const ErrorGroupsContainer = styled.div`
  padding: 20px;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
`;

const ErrorGroupHeader = styled.h2`
  margin-bottom: 20px;
  color: #333;
`;

const SummaryBar = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
  padding: 10px;
  background-color: #f5f5f5;
  border-radius: 4px;
`;

const ErrorCount = styled.span<{ $isHighlighted?: boolean }>`
  font-weight: ${(props) => (props.$isHighlighted ? "bold" : "normal")};
  color: ${(props) => (props.$isHighlighted ? "#f44336" : "inherit")};
`;

interface ErrorGroup {
  CleanError: string;
  count: number;
  sampleError: string;
  sampleReferenceId: string;
  statusCode: number;
}

const ErrorGroups: React.FC = () => {
  // State
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [tableName, setTableName] = useState("all");
  const [jobType, setJobType] = useState("all");
  const [errorGroups, setErrorGroups] = useState<ErrorGroup[]>([]);
  const [totalErrors, setTotalErrors] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [sourceTableName, setSourceTableName] = useState<string | null>(null);

  // Fetch job types for filter
  useEffect(() => {
    const fetchJobTypes = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/job/job-types`
        );
        const jobNames = response.data.map((job: any) => job.JobTypeName);
        setJobTypes(jobNames);
      } catch (error) {
        console.error("Error fetching job types:", error);
      }
    };

    fetchJobTypes();
  }, []);

  // Fetch table names for filter
  useEffect(() => {
    const fetchTableNames = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/dashboard/db-tables`
        );
        setTableNames(response.data);
      } catch (error) {
        console.error("Error fetching table names:", error);
      }
    };

    fetchTableNames();
  }, []);

  // Fetch error groups
  useEffect(() => {
    const fetchErrorGroups = async () => {
      if (jobType === "all" && tableName === "all") {
        return;
      }

      setIsLoading(true);
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/dashboard/error-groups`,
          {
            params: {
              jobType,
              tableName,
            },
          }
        );

        setErrorGroups(response.data.errorGroups);
        setTotalErrors(response.data.totalErrors);
        setSourceTableName(response.data.tableName);
      } catch (error) {
        console.error("Error fetching error groups:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchErrorGroups();
  }, [jobType, tableName]);

  // Handler for job type selection
  const handleJobTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setJobType(e.target.value);
    setTableName("all"); // Reset table selection when job type changes
  };

  // Handler for table name selection
  const handleTableNameChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTableName(e.target.value);
    setJobType("all"); // Reset job type selection when table changes
  };

  return (
    <ErrorGroupsContainer>
      <ErrorGroupHeader>Error Group Analysis</ErrorGroupHeader>

      <FilterContainer>
        <FilterItem>
          <label>Job Type:</label>
          <select value={jobType} onChange={handleJobTypeChange}>
            <option value="all">Select Job Type</option>
            {jobTypes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </FilterItem>

        <FilterItem>
          <label>OR Table Name:</label>
          <select value={tableName} onChange={handleTableNameChange}>
            <option value="all">Select Table</option>
            {tableNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </FilterItem>
      </FilterContainer>

      {isLoading && (
        <LoadingOverlay>
          <div className="spinner"></div>
        </LoadingOverlay>
      )}

      {!isLoading && sourceTableName && (
        <>
          <SummaryBar>
            <div>
              Source Table: <strong>{sourceTableName}</strong>
            </div>
            <div>
              Total Errors:{" "}
              <ErrorCount $isHighlighted={true}>{totalErrors}</ErrorCount>
            </div>
            <div>
              Error Categories: <strong>{errorGroups.length}</strong>
            </div>
          </SummaryBar>

          {errorGroups.length > 0 ? (
            <DataTable>
              <thead>
                <tr>
                  <th>Error Description</th>
                  <th>Count</th>
                  <th>Sample Full Error</th>
                  <th>Status Code</th>
                  <th>Sample Reference ID</th>
                </tr>
              </thead>
              <tbody>
                {errorGroups.map((group, index) => (
                  <tr key={index}>
                    <td>{group.CleanError}</td>
                    <td>
                      <ErrorCount $isHighlighted={true}>
                        {group.count}
                      </ErrorCount>
                    </td>
                    <td title={group.sampleError}>
                      {group.sampleError?.length > 50
                        ? `${group.sampleError.substring(0, 50)}...`
                        : group.sampleError}
                    </td>
                    <td>{group.statusCode}</td>
                    <td>{group.sampleReferenceId}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p>No errors found for the selected criteria.</p>
          )}
        </>
      )}

      {!isLoading && !sourceTableName && jobType !== "all" && (
        <p>No data source found for the selected job type.</p>
      )}

      {!isLoading && !sourceTableName && tableName !== "all" && (
        <p>Unable to find or access the selected table.</p>
      )}

      {!isLoading && jobType === "all" && tableName === "all" && (
        <p>Please select a Job Type or Table Name to view error groups.</p>
      )}
    </ErrorGroupsContainer>
  );
};

export default ErrorGroups;
