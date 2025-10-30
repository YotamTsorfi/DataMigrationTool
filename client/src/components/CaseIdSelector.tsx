/**
 * CaseIdSelector component provides a dropdown selector for case IDs from the sample_case_id_stg table.
 * It automatically selects the "full" case ID when available or falls back to the first option.
 * This component is used to filter job processing data based on the selected case ID.
 */
import React, { useState, useEffect } from "react";
import styled from "styled-components";
import axios from "axios";
import { SelectControl } from "./BatchProcessorStyles";

interface CaseIdSelectorProps {
  onCaseIdSelect: (caseId: string) => void;
  selectedCaseId?: string;
  className?: string;
}

const HelperText = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
`;

const CaseIdSelector: React.FC<CaseIdSelectorProps> = ({
  onCaseIdSelect,
  selectedCaseId,
  className,
}) => {
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCaseIds = async (): Promise<void> => {
      try {
        setLoading(true);
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/job/active-case-ids`
        );

        if (response.data.success && Array.isArray(response.data.data)) {
          setCaseIds(response.data.data);

          // Only auto-select if no value is already selected
          if (!selectedCaseId && response.data.data.length > 0) {
            // Look for 'full' in the array of case IDs
            const fullCaseId = response.data.data.find(
              (caseId: string) => caseId === "full"
            );

            // If 'full' exists, select it; otherwise select the first item
            if (fullCaseId) {
              onCaseIdSelect(fullCaseId);
            } else {
              onCaseIdSelect(response.data.data[0]);
            }
          }
        } else {
          setError("Failed to load case IDs");
        }
      } catch (err) {
        setError("Error connecting to the server");
        console.error("Failed to fetch case IDs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchCaseIds();
  }, [onCaseIdSelect, selectedCaseId]);

  if (loading) return <div className={className}>Loading case IDs...</div>;
  if (error) return <div className={`error ${className}`}>{error}</div>;
  if (caseIds.length === 0)
    return <div className={className}>No active case IDs available</div>;

  return (
    <div className={`case-id-selector ${className || ""}`}>
      <SelectControl
        id="case-id-select"
        value={selectedCaseId || ""}
        onChange={(e) => onCaseIdSelect(e.target.value)}
        aria-label="Select Case ID"
      >
        <option value="" disabled>
          Select Case ID…
        </option>
        {caseIds.map((caseId: string) => {
          const isFull = caseId.toLowerCase() === "full";
          const label = isFull ? "full" : caseId;
          return (
            <option key={caseId} value={caseId}>
              {label}
            </option>
          );
        })}
      </SelectControl>
      {selectedCaseId && (
        <HelperText>
          Selected case:{" "}
          {selectedCaseId.toLowerCase() === "full"
            ? "full (All records)"
            : selectedCaseId}
        </HelperText>
      )}
    </div>
  );
};

export default CaseIdSelector;
