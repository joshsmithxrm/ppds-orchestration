import { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';
import Settings from './pages/Settings';
import SoundToggle from './components/SoundToggle';
import { useSounds, UseSoundsReturn } from './hooks/useSounds';

interface SoundsConfig {
  muteRalph?: boolean;
  onSpawn?: string;
  onStuck?: string;
  onComplete?: string;
}

interface CentralConfig {
  sounds?: SoundsConfig;
}

// Context for config (needed for muteRalph check)
const ConfigContext = createContext<CentralConfig | null>(null);

export function useConfigContext(): CentralConfig | null {
  return useContext(ConfigContext);
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
    <ConfigContext.Provider value={config}>
    <SoundsContext.Provider value={sounds}>
      <div className="h-screen flex flex-col bg-ppds-bg overflow-hidden">
        <header className="bg-ppds-header border-b border-gray-800 relative flex-shrink-0">
          <Link to="/" className="block py-3 hover:opacity-90 transition-opacity">
            <img src="/orchestrator-banner.png" alt="Orchestrator" className="max-w-sm mx-auto" />
          </Link>
          <div className="absolute bottom-2 right-4 flex items-center gap-3">
            <Link
              to="/settings"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Settings
            </Link>
            <SoundToggle enabled={sounds.enabled} onToggle={sounds.toggle} />
          </div>
        </header>
        <main className="flex-1 overflow-hidden p-4">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/session/:repoId/:sessionId" element={<SessionView />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </SoundsContext.Provider>
    </ConfigContext.Provider>
  );
}

export default App;
