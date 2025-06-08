/**
 * This component displays statistics about successfully processed records
 * for a selected job type or table. It shows success count, total count,
 * and calculates the success rate with visual indicators.
 */

import React, { useState, useEffect } from "react";
import axios from "axios";
import styled from "styled-components";
import {
  FilterContainer,
  FilterItem,
  LoadingOverlay,
} from "../styles/BatchDashboardStyles";

// Styled components for the success records view
const SuccessRecordsContainer = styled.div`
  padding: 20px;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
`;

const SuccessRecordsHeader = styled.h2`
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

const StatsCard = styled.div`
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 20px;
  margin-bottom: 20px;
  text-align: center;
`;

const StatNumber = styled.div`
  font-size: 32px;
  font-weight: bold;
  color: #4caf50;
  margin: 10px 0;
`;

const StatLabel = styled.div`
  font-size: 14px;
  color: #666;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
`;

const SuccessRate = styled.div<{ $rate: number }>`
  font-size: 32px;
  font-weight: bold;
  color: ${(props) => {
    if (props.$rate >= 90) return "#4caf50";
    if (props.$rate >= 70) return "#ff9800";
    return "#f44336";
  }};
  margin: 10px 0;
`;

interface SuccessRecordsProps {}

const SuccessRecords: React.FC<SuccessRecordsProps> = () => {
  // State management
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [tableName, setTableName] = useState("all");
  const [jobType, setJobType] = useState("all");
  const [successCount, setSuccessCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [successRate, setSuccessRate] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [sourceTableName, setSourceTableName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Fetch job types for filter dropdown
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

  // Fetch table names for filter dropdown
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

  // Fetch success records data when filters change
  useEffect(() => {
    const fetchSuccessData = async () => {
      if (jobType === "all" && tableName === "all") {
        setMessage(
          "Please select a Job Type or Table Name to view success records."
        );
        return;
      }

      setIsLoading(true);
      setMessage(null);

      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/dashboard/success-records`,
          {
            params: {
              jobType,
              tableName,
            },
          }
        );

        if (response.data.message) {
          setMessage(response.data.message);
        }

        setSuccessCount(response.data.successCount);
        setTotalCount(response.data.totalCount);
        setSuccessRate(response.data.successRate);
        setSourceTableName(response.data.tableName);
      } catch (error) {
        console.error("Error fetching success records data:", error);
        setMessage("Error fetching success records data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuccessData();
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

  const formatNumber = (num: number): string => {
    return num.toLocaleString();
  };

  return (
    <SuccessRecordsContainer>
      <SuccessRecordsHeader>Success Records Analysis</SuccessRecordsHeader>

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

      {!isLoading && message && (
        <div style={{ textAlign: "center", padding: "20px" }}>
          <p>{message}</p>
        </div>
      )}

      {!isLoading && sourceTableName && !message && (
        <>
          <SummaryBar>
            <div>
              Source Table: <strong>{sourceTableName}</strong>
            </div>
          </SummaryBar>

          <StatsGrid>
            <StatsCard>
              <StatLabel>Success Records</StatLabel>
              <StatNumber>{formatNumber(successCount)}</StatNumber>
            </StatsCard>

            <StatsCard>
              <StatLabel>Total Eligible Records</StatLabel>
              <StatNumber>{formatNumber(totalCount)}</StatNumber>
            </StatsCard>

            <StatsCard>
              <StatLabel>Success Rate</StatLabel>
              <SuccessRate $rate={successRate}>{successRate}%</SuccessRate>
            </StatsCard>
          </StatsGrid>
        </>
      )}
    </SuccessRecordsContainer>
  );
};

export default SuccessRecords;
