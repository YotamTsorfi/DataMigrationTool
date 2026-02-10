import styled from "styled-components";

export const WhereClauseContainer = styled.div`
  margin-top: 20px;
  border-top: 1px solid #e0e0e0;
  padding-top: 15px;
`;

export const WhereClauseTextarea = styled.textarea<{ $hasError?: boolean }>`
  width: 100%;
  padding: 8px;
  border: 1px solid ${(props) => (props.$hasError ? "red" : "#ccc")};
  border-radius: 4px;
  font-family: monospace;
  font-size: 14px;
  box-sizing: border-box;

  @media (min-width: 900px) {
    width: 100%;
  }
`;
export const ErrorMessage = styled.div`
  color: red;
  font-size: 14px;
  margin-top: 5px;
`;

export const InfoBox = styled.div`
  background-color: #f8f9fa;
  border: 1px solid #ddd;
  padding: 10px;
  margin-top: 10px;
  font-size: 14px;
  border-radius: 4px;

  code {
    background-color: #e9ecef;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: monospace;
  }
`;

export const ButtonGroup = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 10px;
`;

export const MainContainer = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 20px;
  flex-wrap: wrap;
  gap: 20px;

  @media (max-width: 900px) {
    flex-direction: column;
    padding: 10px;
    gap: 10px;
  }
`;
export const SectionContainer = styled.div`
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 8px;
  margin-bottom: 20px;
  width: 100%;

  @media (min-width: 992px) {
    width: 80%; // Slightly wider than before for desktop
  }
`;

export const ConfigSectionContainer = styled(SectionContainer)`
  @media (min-width: 1500px) {
    width: 100%; // Give more room to System Configuration
  }
`;

export const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
  gap: 12px;

  @media (min-width: 700px) {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 20px;
    align-items: flex-start;
  }
`;
export const InputLabel = styled.label`
  display: flex;
  flex-direction: column;
  margin-right: 10px;
  min-width: 180px;
  width: 100%;
  font-size: 15px;
  font-weight: 500;
  gap: 4px;

  @media (min-width: 700px) {
    min-width: 220px;
    max-width: 320px;
    width: 45%;
  }

  @media (max-width: 500px) {
    min-width: 120px;
    font-size: 14px;
  }
`;
export const Button = styled.button`
  padding: 10px 20px;
  min-width: 0;
  height: 38px;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:disabled {
    font-size: 15px;
  }
`;

// Modern, accessible form controls
export const TextInput = styled.input<{ $hasError?: boolean }>`
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 8px 12px;
  border: 1px solid ${(p) => (p.$hasError ? "#dc3545" : "#d0d7de")};
  border-radius: 8px;
  background: #fff;
  color: #111827;
  font-size: 15px;
  line-height: 1.4;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;

  &:hover {
    border-color: ${(p) => (p.$hasError ? "#dc3545" : "#9aa4af")};
  }

  &:focus {
    outline: none;
    border-color: ${(p) => (p.$hasError ? "#dc3545" : "#4dabf7")};
    box-shadow: 0 0 0 3px
      ${(p) =>
        p.$hasError ? "rgba(220, 53, 69, 0.25)" : "rgba(77, 171, 247, 0.3)"};
  }

  &::placeholder {
    color: #9aa4af;
  }

  &:disabled {
    background: #f5f6f8;
    color: #6b7280;
    cursor: not-allowed;
  }

  @media (max-width: 500px) {
    font-size: 13px;
    padding: 6px 8px;
    height: 32px;
  }
`;

export const SelectControl = styled.select<{ $hasError?: boolean }>`
  width: 100%;
  height: 38px;
  padding: 8px 36px 8px 12px;
  border: 1px solid ${(p) => (p.$hasError ? "#dc3545" : "#d0d7de")};
  border-radius: 8px;
  background: #fff;
  color: #111827;
  font-size: 14px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg fill='none' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7 10l5 5 5-5' stroke='%239AA4AF' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 16px 16px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    border-color: ${(p) => (p.$hasError ? "#dc3545" : "#9aa4af")};
  }

  &:focus {
    outline: none;
    border-color: ${(p) => (p.$hasError ? "#dc3545" : "#4dabf7")};
    box-shadow: 0 0 0 3px
      ${(p) =>
        p.$hasError ? "rgba(220, 53, 69, 0.25)" : "rgba(77, 171, 247, 0.3)"};
  }

  &:disabled {
    background: #f5f6f8;
    color: #6b7280;
    cursor: not-allowed;
  }
`;

export const CheckboxInput = styled.input.attrs({ type: "checkbox" })`
  width: 18px;
  height: 18px;
  accent-color: #4dabf7; /* modern, native coloring */
  cursor: pointer;

  &:disabled {
    accent-color: #9aa4af;
    cursor: not-allowed;
  }
`;

export const TableContainer = styled.div`
  max-height: 300px;
  overflow-y: auto;
  margin-top: 20px;
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

export const Th = styled.th`
  background-color: #f2f2f2;
  padding: 10px;
  border: 1px solid #ddd;
`;

export const Td = styled.td`
  padding: 10px;
  border: 1px solid #ddd;
`;

export const ReadOnlyInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 8px 12px;
  background-color: #f7f7f9;
  border: 1px solid #d0d7de;
  color: #495057;
  border-radius: 8px;
  cursor: not-allowed;

  @media (max-width: 500px) {
    font-size: 13px;
    padding: 6px 8px;
    height: 32px;
  }
`;

export const ResultsContainer = styled.div`
  padding: 20px;
`;

export const LargeSectionContainer = styled(SectionContainer)`
  width: 90%; /* Adjust the width as needed */
`;

export const RadioGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 15px;
`;

export const RadioButton = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;

  input[type="radio"] {
    margin: 0;
  }

  label {
    margin: 0;
    font-weight: 500;
  }

  .info-tooltip {
    display: none;
    position: absolute;
    background-color: #333;
    color: white;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    z-index: 10;
    width: 250px;
    top: -5px;
    left: 50%;
    margin-left: 10px;
  }

  &:hover .info-tooltip {
    display: block;
  }
`;
