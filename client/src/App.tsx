// client/src/App.tsx

import BatchProcessor from "./components/BatchProcessor";
import BatchDashboard from "./components/BatchDashboard";
import "./App.css";

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Carmelton Data Migration System</h1>
      </header>
      <main>
        <BatchProcessor />
        <BatchDashboard />
      </main>
    </div>
  );
}

export default App;