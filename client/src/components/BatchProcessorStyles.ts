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
  resize: vertical;
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
`;

export const InputLabel = styled.label`
  display: flex;
  flex-direction: column;
  margin-right: 10px;
  width: 200px; /* Set a fixed width */
`;

export const Button = styled.button`
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:disabled {
    background-color: #ccc;
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
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  color: #666;
  cursor: not-allowed;
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
