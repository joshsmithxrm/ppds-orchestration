import { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';
import Settings from './pages/Settings';
import SoundToggle from './components/SoundToggle';
import { useSounds, UseSoundsReturn } from './hooks/useSounds';

interface SoundsConfig {
  onSpawn?: string;
  onStuck?: string;
  onComplete?: string;
}

interface CentralConfig {
  sounds?: SoundsConfig;
}

// Context for sounds
const SoundsContext = createContext<UseSoundsReturn | null>(null);

export function useSoundsContext(): UseSoundsReturn | null {
  return useContext(SoundsContext);
}

function App() {
  const [config, setConfig] = useState<CentralConfig | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => setConfig(data.config))
      .catch(console.error);
  }, []);

  const sounds = useSounds(config?.sounds);

  return (
    <SoundsContext.Provider value={sounds}>
      <div className="min-h-screen">
        <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xl font-bold text-white hover:text-gray-200">
              Orchestration Hub
            </Link>
            <div className="flex items-center gap-4">
              <Link
                to="/settings"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Settings
              </Link>
              <SoundToggle enabled={sounds.enabled} onToggle={sounds.toggle} />
            </div>
          </div>
        </header>
        <main className="p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/session/:repoId/:sessionId" element={<SessionView />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </SoundsContext.Provider>
  );
}

export default App;
