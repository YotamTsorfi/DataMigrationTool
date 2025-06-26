/**
 * Main application component that handles routing and authentication
 * Provides navigation between the batch processor, dashboard, and job types manager
 * Includes toast notification support for user feedback
 */
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./App.css";
import { useGlobalAuthCheck } from "./hooks/useGlobalAuthCheck";
import BatchProcessor from "./components/BatchProcessor";
import JobScheduler from "./components/JobScheduler/JobScheduler";
import BatchDashboard from "./components/BatchDashboard";
import JobTypesManager from "./components/JobTypesManager/JobTypesManager";
import ConfigPanel from "./components/ConfigPanel";
import { AuthProvider } from "./context/AuthContext";
import AuthStatus from "./components/AuthStatus";
import styled from "styled-components";

const Header = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
`;

const Navigation = styled.nav`
  display: flex;
  gap: 20px;
  margin: 10px 0;
  padding: 10px;
  background-color: #f0f0f0;

  a {
    padding: 8px 16px;
    text-decoration: none;
    color: #333;
    font-weight: 500;
    border-radius: 4px;

    &:hover {
      background-color: #e0e0e0;
    }

    &.active {
      background-color: #007bff;
      color: white;
    }
  }
`;

function App() {
  useGlobalAuthCheck();
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="App">
          <Header className="App-header">
            <h1>Carmelton Data Migration System</h1>
            <AuthStatus />
          </Header>
          <Navigation>
            <Link to="/">Batch/Queue Processor</Link>
            <Link to="/job-scheduler">Job Scheduler</Link>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/jobtypes">Job Types Manager</Link>
            <Link to="/config">System Configuration</Link>
          </Navigation>
          <main>
            <Routes>
              <Route path="/" element={<BatchProcessor />} />
              <Route path="/job-scheduler" element={<JobScheduler />} />
              <Route path="/dashboard" element={<BatchDashboard />} />
              <Route path="/jobtypes" element={<JobTypesManager />} />
              <Route path="/config" element={<ConfigPanel />} />
            </Routes>
          </main>

          {/* Toast notification container */}
          <ToastContainer
            position="top-right"
            autoClose={3000}
            hideProgressBar={false}
            newestOnTop
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            theme="light"
            style={{ zIndex: 9999 }}
          />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
