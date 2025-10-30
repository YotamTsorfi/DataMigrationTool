import React from "react";
import { Table, Th, Td, TableContainer } from "./BatchProcessorStyles";
import { IChildJob } from "./JobTypesManager/JobTypesManager";
import styled from "styled-components";

interface ChildJobsProps {
  childJobs: IChildJob[];
  isLoading: boolean;
  selectedJobType: string;
}

// Responsive wrappers specific to child jobs
const ChildJobsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ResponsiveTableWrapper = styled(TableContainer)`
  overflow-x: auto;
  max-width: 100%;

  table {
    min-width: 680px; // prevent cramped columns on small screens
  }
`;

const CardsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
`;

const Card = styled.div`
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
`;

const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed #f0f0f0;

  &:last-child {
    border-bottom: none;
  }
`;

const Label = styled.span`
  color: #6b7280; // gray-500
  font-size: 12px;
`;

const Value = styled.span`
  color: #111827; // gray-900
  font-size: 13px;
  font-weight: 500;
  text-align: right;
`;

const Pill = styled.span<{ $variant?: "success" | "muted" }>`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: ${({ $variant }) => ($variant === "success" ? "#0f5132" : "#1f2937")};
  background: ${({ $variant }) =>
    $variant === "success" ? "#d1e7dd" : "#e5e7eb"};
`;

const SectionTitle = styled.h3`
  margin: 0 0 6px 0;
`;

/**
 * ChildJobs renders a responsive view of child jobs:
 * - Desktop: wide table with horizontal scroll fallback
 * - Mobile: compact cards with key fields
 */
const ChildJobs: React.FC<ChildJobsProps> = ({
  childJobs,
  isLoading,
  selectedJobType,
}) => {
  // Basic guard rails
  if (isLoading) return <p>Loading child jobs...</p>;

  if (!Array.isArray(childJobs) || childJobs.length === 0) {
    return (
      <ChildJobsContainer>
        <SectionTitle>Child Jobs</SectionTitle>
        {selectedJobType ? (
          <p>No child jobs found for this job type.</p>
        ) : (
          <p>Select a job type to view child jobs.</p>
        )}
      </ChildJobsContainer>
    );
  }

  return (
    <ChildJobsContainer>
      <SectionTitle>Child Jobs</SectionTitle>

      {/* Desktop/tablet first: table with safe min-width and scroll */}
      <div className="desktop-only">
        <ResponsiveTableWrapper>
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
              {childJobs.map((child) => (
                <tr
                  key={
                    child.ChildJobeId ??
                    `${child.JobTypeName}-${child.DBTableName}`
                  }
                >
                  <Td>{child.JobTypeName}</Td>
                  <Td>{child.DBTableName}</Td>
                  <Td>{child.ScreenName}</Td>
                  <Td>{child.HasSiblings ? "Yes" : "No"}</Td>
                  <Td>{child.priority_id ?? "-"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </ResponsiveTableWrapper>
      </div>

      {/* Mobile: cards layout */}
      <div className="mobile-only">
        <CardsGrid>
          {childJobs.map((child) => (
            <Card
              key={
                child.ChildJobeId ??
                `${child.JobTypeName}-${child.DBTableName}-card`
              }
            >
              <Row>
                <Label>Job Type</Label>
                <Value>{child.JobTypeName}</Value>
              </Row>
              <Row>
                <Label>DB Table</Label>
                <Value>{child.DBTableName}</Value>
              </Row>
              <Row>
                <Label>Screen</Label>
                <Value>{child.ScreenName}</Value>
              </Row>
              <Row>
                <Label>Has Siblings</Label>
                <Value>
                  <Pill $variant={child.HasSiblings ? "success" : "muted"}>
                    {child.HasSiblings ? "Yes" : "No"}
                  </Pill>
                </Value>
              </Row>
              <Row>
                <Label>Priority ID</Label>
                <Value>{child.priority_id ?? "-"}</Value>
              </Row>
            </Card>
          ))}
        </CardsGrid>
      </div>

      {/* Small CSS helpers to toggle views by width */}
      <style>{`
        @media (max-width: 991px) { /* mobile/tablet */
          .desktop-only { display: none; }
          .mobile-only { display: block; }
        }
        @media (min-width: 992px) { /* desktop */
          .desktop-only { display: block; }
          .mobile-only { display: none; }
        }
      `}</style>
    </ChildJobsContainer>
  );
};

export default ChildJobs;
