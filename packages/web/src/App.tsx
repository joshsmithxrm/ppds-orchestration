import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';

function App() {
  return (
    <div className="min-h-screen">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white">Orchestration Hub</h1>
          <div className="text-sm text-gray-400">
            Multi-repo worker management
          </div>
        </div>
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/session/:repoId/:sessionId" element={<SessionView />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
