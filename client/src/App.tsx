// client/src/App.tsx
//import React from 'react';
import BatchProcessor from './components/BatchProcessor';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Carmelton Management System</h1>
      </header>
      <main>
        <BatchProcessor />
      </main>
    </div>
  );
}

export default App;