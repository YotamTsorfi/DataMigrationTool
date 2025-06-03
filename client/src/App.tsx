import React from "react";
import "./App.css";
import { useGlobalAuthCheck } from "./hooks/useGlobalAuthCheck";
import BatchProcessor from "./components/BatchProcessor";
import BatchDashboard from "./components/BatchDashboard";
import { AuthProvider } from "./context/AuthContext";
import AuthStatus from "./components/AuthStatus";
import styled from "styled-components";

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
`;

function App() {
  useGlobalAuthCheck();
  return (
    <AuthProvider>
      <div className="App">
        <Header className="App-header">
          <h1>Carmelton Data Migration System</h1>
          <AuthStatus />
        </Header>
        <main>
          <BatchProcessor />
          <BatchDashboard />
        </main>
      </div>
    </AuthProvider>
  );
}

export default App;
