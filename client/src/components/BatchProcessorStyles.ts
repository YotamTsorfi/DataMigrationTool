import styled from "styled-components";

export const MainContainer = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 20px;
`;

export const SectionContainer = styled.div`
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 8px;
  margin-bottom: 20px;
  width: 45%; /* Adjust the width as needed */
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