/**
 * Component for copying failed records from source tables to the central error logs table
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import styled from "styled-components";
import {
  FilterContainer,
  FilterItem,
  LoadingOverlay,
} from "../styles/BatchDashboardStyles";

const ErrorCopyContainer = styled.div`
  padding: 20px;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
`;

const ErrorCopyHeader = styled.h2`
  margin-bottom: 20px;
  color: #333;
`;

const CopyButton = styled.button`
  background-color: #4caf50;
  color: white;
  padding: 10px 15px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  margin-top: 20px;
  transition: background-color 0.3s;

  &:hover {
    background-color: #45a049;
  }

  &:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }
`;

const StatusMessage = styled.div<{ $isError?: boolean }>`
  margin-top: 20px;
  padding: 15px;
  border-radius: 4px;
  background-color: ${(props) => (props.$isError ? "#ffebee" : "#e8f5e9")};
  color: ${(props) => (props.$isError ? "#c62828" : "#2e7d32")};
  border-left: 5px solid ${(props) => (props.$isError ? "#c62828" : "#2e7d32")};
`;

const Description = styled.p`
  margin-bottom: 20px;
  color: #666;
  line-height: 1.5;
`;

interface ErrorCopyToolProps {}

const ErrorCopyTool: React.FC<ErrorCopyToolProps> = () => {
  // State management
  const [tableName, setTableName] = useState("all");
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  // Fetch table names for dropdown
  useEffect(() => {
    const fetchTableNames = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/dashboard/db-tables`
        );
        setTableNames(response.data);
      } catch (error) {
        console.error("Error fetching table names:", error);
        setMessage({
          text: "Failed to load database tables. Please try again.",
          isError: true,
        });
      }
    };

    fetchTableNames();
  }, []);

  // Handle table selection change
  const handleTableNameChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTableName(e.target.value);
    setMessage(null);
  };

  // Handle copy operation
  const handleCopyErrors = async () => {
    if (tableName === "all") {
      setMessage({
        text: "Please select a specific table to copy errors from.",
        isError: true,
      });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/dashboard/copy-failed-records`,
        { sourceTableName: tableName }
      );

      if (response.data.success) {
        setMessage({
          text: response.data.message,
          isError: false,
        });
      } else {
        setMessage({
          text: response.data.message || "Failed to copy error records.",
          isError: true,
        });
      }
    } catch (error) {
      console.error("Error copying failed records:", error);
      setMessage({
        text:
          error instanceof Error ? error.message : "An unknown error occurred",
        isError: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ErrorCopyContainer>
      <ErrorCopyHeader>Error Records Copy Tool</ErrorCopyHeader>

      <Description>
        This tool allows you to copy failed records (Status = 'Failed') from a
        selected source table to the central error logs table
        (PriorityErrorLogs). This helps consolidate errors from different data
        sources for easier analysis and troubleshooting.
      </Description>

      <FilterContainer>
        <FilterItem>
          <label>Select Source Table:</label>
          <select value={tableName} onChange={handleTableNameChange}>
            <option value="all">-- Select a Table --</option>
            {tableNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </FilterItem>
      </FilterContainer>

      <CopyButton
        onClick={handleCopyErrors}
        disabled={tableName === "all" || isLoading}
      >
        {isLoading ? "Copying..." : "Copy Failed Records"}
      </CopyButton>

      {isLoading && (
        <LoadingOverlay>
          <div className="spinner"></div>
        </LoadingOverlay>
      )}

      {message && (
        <StatusMessage $isError={message.isError}>{message.text}</StatusMessage>
      )}
    </ErrorCopyContainer>
  );
};

export default ErrorCopyTool;
