import styled from "styled-components";

export const DashboardContainer = styled.div`
  padding: 20px;
  background-color: #f8f9fa;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

export const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
`;

export const SummaryCard = styled.div`
  background-color: #ffffff;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  text-align: center;

  &.success {
    border-left: 4px solid #4caf50;
  }

  &.error {
    border-left: 4px solid #f44336;
  }

  &.in-progress {
    border-left: 4px solid #2196f3;
  }

  &.info {
    border-left: 4px solid #ff9800;
  }

  h3 {
    margin-top: 0;
    font-size: 14px;
    color: #666;
    font-weight: normal;
  }

  p.number {
    margin: 8px 0 0;
    font-size: 28px;
    font-weight: bold;
  }
`;

export const ChartContainer = styled.div`
  background-color: #ffffff;
  padding: 16px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 24px;
  height: 300px;
`;

export const ChartRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 24px;

  @media (max-width: 1200px) {
    grid-template-columns: 1fr;
  }
`;

export const TabContainer = styled.div`
  margin-bottom: 20px;
`;

interface TabProps {
  $active: boolean;
}
export const Tab = styled.button<TabProps>`
  padding: 10px 20px;
  background-color: ${(props) => (props.$active ? "#007bff" : "#f0f0f0")};
  color: ${(props) => (props.$active ? "white" : "#333")};
  border: none;
  border-bottom: ${(props) => (props.$active ? "3px solid #0056b3" : "none")};
  cursor: pointer;

  &:hover {
    background-color: ${(props) => (props.$active ? "#0069d9" : "#e0e0e0")};
  }
`;

export const TabContent = styled.div`
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 0 4px 4px 4px;
  background-color: #ffffff;
`;

export const FilterContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

export const FilterItem = styled.div`
  margin-right: 16px;
  margin-bottom: 10px;

  label {
    margin-right: 8px;
    font-weight: 500;
  }

  select,
  input {
    padding: 6px 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
`;

export const DataTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;

  th,
  td {
    padding: 10px;
    text-align: left;
    border-bottom: 1px solid #eee;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  th:first-child,
  td:first-child {
    width: 200px; /* Adjust width for JobId column */
    white-space: normal;
    overflow: visible;
  }

  th {
    background-color: #f5f5f5;
    font-weight: 500;
  }

  tr:hover td {
    background-color: #f9f9f9;
  }
`;

interface StatusBadgeProps {
  $status: string;
}
export const StatusBadge = styled.span<StatusBadgeProps>`
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  background-color: ${(props) => {
    switch (props.$status.toLowerCase()) {
      case "completed":
        return "#4caf50";
      case "failed":
        return "#f44336";
      case "running":
        return "#2196f3";
      case "queued":
        return "#ff9800";
      case "completedbutnotsynced":
        return "#9c27b0";
      default:
        return "#757575";
    }
  }};
  color: white;
`;

export const LoadingOverlay = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  width: 100%;

  .spinner {
    border: 4px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top: 4px solid #3498db;
    width: 30px;
    height: 30px;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;

export const Pagination = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;

  button {
    background-color: #fff;
    border: 1px solid #ddd;
    padding: 5px 10px;
    margin-left: 5px;
    cursor: pointer;

    &:disabled {
      background-color: #f5f5f5;
      cursor: not-allowed;
    }

    &.active {
      background-color: #007bff;
      color: white;
      border-color: #007bff;
    }
  }
`;
