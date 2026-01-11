import { useEffect, useState, useCallback } from 'react';
import { invoke, listen, isTauri } from './lib/tauri-mock';
import { WorkerList } from './components/WorkerList';
import { Header } from './components/Header';
import { SpawnWorkerModal } from './components/SpawnWorkerModal';
import type { SessionState } from './types';

interface SessionEvent {
  eventType: 'add' | 'update' | 'remove';
  session?: SessionState;
  sessionId?: string;
}

function App() {
  const [sessions, setSessions] = useState<SessionState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Spawn modal state
  const [isSpawnModalOpen, setSpawnModalOpen] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [isSpawning, setIsSpawning] = useState(false);

  // Fetch initial sessions
  const fetchSessions = useCallback(async () => {
    try {
      const data = await invoke<SessionState[]>('get_sessions');
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle spawning a new worker
  const handleSpawnWorker = async (issueNumber: number) => {
    setIsSpawning(true);
    setSpawnError(null);
    try {
      await invoke('spawn_worker', { issueNumber });
      setSpawnModalOpen(false);
      // In Tauri mode, file watcher emits events. In mock mode, refresh manually.
      if (!isTauri()) {
        await fetchSessions();
      }
    } catch (err) {
      setSpawnError(String(err));
    } finally {
      setIsSpawning(false);
    }
  };

  // Handle closing the spawn modal
  const handleCloseSpawnModal = () => {
    setSpawnModalOpen(false);
    setSpawnError(null);
  };

  useEffect(() => {
    // Fetch initial sessions
    fetchSessions();

    // Listen for real-time session updates from the Rust backend
    const unlisten = listen<SessionEvent>('session-event', (event) => {
      const { eventType, session, sessionId } = event.payload;

      setSessions((prev) => {
        if (eventType === 'remove' && sessionId) {
          return prev.filter((s) => s.id !== sessionId);
        }

        if ((eventType === 'add' || eventType === 'update') && session) {
          const existingIndex = prev.findIndex((s) => s.id === session.id);
          if (existingIndex >= 0) {
            // Update existing session
            const updated = [...prev];
            updated[existingIndex] = session;
            return updated;
          } else {
            // Add new session
            return [...prev, session];
          }
        }

        return prev;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchSessions]);

  const mockMode = !isTauri();

  return (
    <div className="min-h-screen bg-dark-bg">
      <Header isMockMode={mockMode} onSpawnClick={() => setSpawnModalOpen(true)} />
      <main className="container mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 rounded p-4 mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-dark-muted">Loading sessions...</div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="text-dark-muted mb-4">No active sessions</div>
            <p className="text-sm text-dark-muted">
              Spawn a worker with <code className="bg-dark-surface px-2 py-1 rounded">orch spawn &lt;issue&gt;</code>
              {' '}or click the button above
            </p>
          </div>
        ) : (
          <WorkerList sessions={sessions} />
        )}
      </main>

      <SpawnWorkerModal
        isOpen={isSpawnModalOpen}
        onClose={handleCloseSpawnModal}
        onSpawn={handleSpawnWorker}
        error={spawnError}
        isLoading={isSpawning}
      />
    </div>
  );
}

export default App;
