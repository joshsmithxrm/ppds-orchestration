import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import SpawnDialog from '../components/SpawnDialog';
import { useSoundsContext, useConfigContext } from '../App';

// Note: These are duplicated from core to avoid importing Node.js dependencies into browser
const statusColors: Record<string, string> = {
  registered: 'bg-gray-500',
  planning: 'bg-blue-500',
  planning_complete: 'bg-purple-500',
  working: 'bg-green-500',
  shipping: 'bg-cyan-500',
  reviews_in_progress: 'bg-cyan-500',
  pr_ready: 'bg-emerald-400',
  stuck: 'bg-red-500',
  paused: 'bg-yellow-500',
  complete: 'bg-gray-600',
  cancelled: 'bg-gray-600',
};

const statusIcons: Record<string, string> = {
  registered: '[ ]',
  planning: '[~]',
  planning_complete: '[P]',
  working: '[*]',
  shipping: '[>]',
  reviews_in_progress: '[R]',
  pr_ready: '[+]',
  stuck: '[!]',
  paused: '[||]',
  complete: '[\u2713]',
  cancelled: '[x]',
};

interface Session {
  id: string;
  repoId: string;
  issueNumber: number;
  issueTitle: string;
  status: string;
  mode: string;
  branch: string;
  startedAt: string;
  lastHeartbeat: string;
  stuckReason?: string;
  pullRequestUrl?: string;
}

interface Repo {
  id: string;
  path: string;
  sessionCounts: {
    active: number;
    stuck: number;
    complete: number;
  };
}

type FilterCategory = 'active' | 'stuck' | 'completed';

function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSpawnDialog, setShowSpawnDialog] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(
    new Set(['active', 'stuck'])
  );
  const sounds = useSoundsContext();
  const config = useConfigContext();
  const prevSessionsRef = useRef<Map<string, string>>(new Map());

  // Map session status to filter category
  const getSessionCategory = (status: string): FilterCategory | null => {
    if (status === 'stuck') return 'stuck';
    if (status === 'complete') return 'completed';
    if (status === 'cancelled') return null;
    return 'active';
  };

  // Toggle a filter on/off
  const toggleFilter = (filter: FilterCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  // Get dynamic header label based on active filters
  const getFilterLabel = () => {
    const labels: string[] = [];
    if (activeFilters.has('active')) labels.push('Active');
    if (activeFilters.has('stuck')) labels.push('Stuck');
    if (activeFilters.has('completed')) labels.push('Completed');
    if (labels.length === 0) return 'No Filters Selected';
    if (labels.length === 3) return 'All Sessions';
    return `${labels.join(' & ')} Sessions`;
  };

  // Helper to check if sound should play (respects muteRalph)
  const shouldPlaySound = (session: Session | null) => {
    if (!session) return true;
    if (session.mode === 'ralph' && config?.sounds?.muteRalph) return false;
    return true;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionsRes, reposRes] = await Promise.all([
          fetch('/api/sessions?includeCompleted=true'),
          fetch('/api/repos'),
        ]);

        if (!sessionsRes.ok || !reposRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const sessionsData = await sessionsRes.json();
        const reposData = await reposRes.json();

        const loadedSessions = sessionsData.sessions || [];

        // Initialize prevSessionsRef with current statuses to prevent
        // spurious sound triggers on first WebSocket update
        for (const session of loadedSessions) {
          const key = `${session.repoId}:${session.id}`;
          prevSessionsRef.current.set(key, session.status);
        }

        setSessions(loadedSessions);
        setRepos(reposData.repos || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Set up WebSocket for real-time updates
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'session:add' && data.session) {
        setSessions((prev) => {
          // Check if session already exists
          const exists = prev.some(
            (s) => s.id === data.sessionId && s.repoId === data.repoId
          );
          if (exists) return prev;
          return [...prev, { ...data.session, repoId: data.repoId }];
        });
        // Play spawn sound for new session (respects muteRalph)
        if (data.session.status === 'working' || data.session.status === 'registered') {
          if (shouldPlaySound(data.session)) {
            sounds?.playOnSpawn();
          }
        }
      } else if (data.type === 'session:update' && data.session) {
        const key = `${data.repoId}:${data.sessionId}`;
        const prevStatus = prevSessionsRef.current.get(key);
        const newStatus = data.session.status;

        // Play sounds on status transitions (respects muteRalph)
        if (prevStatus !== newStatus) {
          if (shouldPlaySound(data.session)) {
            if (newStatus === 'stuck') {
              sounds?.playOnStuck();
            } else if (newStatus === 'complete') {
              sounds?.playOnComplete();
            }
          }
          prevSessionsRef.current.set(key, newStatus);
        }

        setSessions((prev) =>
          prev.map((s) =>
            s.id === data.sessionId && s.repoId === data.repoId
              ? { ...data.session, repoId: data.repoId }
              : s
          )
        );
      } else if (data.type === 'session:remove') {
        const key = `${data.repoId}:${data.sessionId}`;
        prevSessionsRef.current.delete(key);
        setSessions((prev) =>
          prev.filter(
            (s) => !(s.id === data.sessionId && s.repoId === data.repoId)
          )
        );
      }
    };

    return () => ws.close();
  }, [sounds]);

  const getElapsedTime = (startedAt: string): string => {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const minutes = Math.floor((now - start) / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const handleSpawn = async (
    repoId: string,
    issueNumbers: number[],
    mode: 'single' | 'ralph',
    iterations?: number
  ) => {
    const res = await fetch(`/api/sessions/${repoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueNumbers, mode, iterations }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to spawn worker');
    }

    // Session will be added via WebSocket event
  };

  const handleDismissSession = async (repoId: string, sessionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.filter((s) => !(s.id === sessionId && s.repoId === repoId))
        );
      }
    } catch (err) {
      console.error('Failed to dismiss session:', err);
    }
  };

  const handleClearCompleted = async () => {
    const completedSessions = sessions.filter((s) => s.status === 'complete');
    for (const session of completedSessions) {
      try {
        await fetch(`/api/sessions/${session.repoId}/${session.id}`, {
          method: 'DELETE',
        });
        setSessions((prev) =>
          prev.filter((s) => !(s.id === session.id && s.repoId === session.repoId))
        );
      } catch (err) {
        console.error('Failed to clear session:', err);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/50 border border-red-700 rounded-lg p-4">
        <h2 className="text-red-400 font-semibold">Error</h2>
        <p className="text-red-300">{error}</p>
        <p className="text-sm text-red-400 mt-2">
          Make sure the orchestration server is running on port 3847.
        </p>
      </div>
    );
  }

  const activeCount = sessions.filter(
    (s) => !['complete', 'cancelled', 'stuck'].includes(s.status)
  ).length;
  const stuckCount = sessions.filter((s) => s.status === 'stuck').length;
  const completedCount = sessions.filter((s) => s.status === 'complete').length;

  // Filter sessions based on active filters
  const filteredSessions = sessions.filter((s) => {
    const category = getSessionCategory(s.status);
    return category && activeFilters.has(category);
  });

  return (
    <div className="space-y-6">
      {/* Header with Spawn Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Dashboard</h2>
        <button
          onClick={() => setShowSpawnDialog(true)}
          className="px-4 py-2 bg-ppds-accent text-ppds-bg font-semibold rounded hover:bg-ppds-accent/80 transition-colors flex items-center gap-2"
        >
          <span>+</span> Spawn Worker
        </button>
      </div>

      {/* Stats - clickable filter cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-ppds-card rounded-lg p-4">
          <div className="text-3xl font-bold text-white">{repos.length}</div>
          <div className="text-sm text-ppds-muted">Repos</div>
        </div>
        <button
          onClick={() => toggleFilter('active')}
          className={`bg-ppds-card rounded-lg p-4 text-left transition-all cursor-pointer ${
            activeFilters.has('active')
              ? 'ring-2 ring-ppds-accent/50'
              : 'opacity-60 hover:opacity-80'
          }`}
        >
          <div className="text-3xl font-bold text-ppds-accent">{activeCount}</div>
          <div className="text-sm text-ppds-muted">Active Workers</div>
        </button>
        <button
          onClick={() => toggleFilter('stuck')}
          className={`bg-ppds-card rounded-lg p-4 text-left transition-all cursor-pointer ${
            activeFilters.has('stuck')
              ? 'ring-2 ring-red-500/50'
              : 'opacity-60 hover:opacity-80'
          }`}
        >
          <div className="text-3xl font-bold text-red-400">{stuckCount}</div>
          <div className="text-sm text-ppds-muted">Stuck</div>
        </button>
        <button
          onClick={() => toggleFilter('completed')}
          className={`bg-ppds-card rounded-lg p-4 text-left transition-all cursor-pointer ${
            activeFilters.has('completed')
              ? 'ring-2 ring-ppds-muted/50'
              : 'opacity-60 hover:opacity-80'
          }`}
        >
          <div className="text-3xl font-bold text-ppds-muted">{completedCount}</div>
          <div className="text-sm text-ppds-muted">Completed</div>
        </button>
      </div>

      {/* Stuck Alert */}
      {stuckCount > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
          <h3 className="text-red-400 font-semibold flex items-center gap-2">
            <span>[!]</span> {stuckCount} worker(s) need attention
          </h3>
        </div>
      )}

      {/* Sessions List */}
      <div className="bg-ppds-card rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{getFilterLabel()}</h2>
          {completedCount > 0 && (
            <button
              onClick={handleClearCompleted}
              className="text-xs text-ppds-muted hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-700"
            >
              Clear Completed ({completedCount})
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-ppds-muted">
            No active sessions. Spawn a worker to get started.
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-ppds-muted">
            No sessions match current filters. Click stat cards to adjust.
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {filteredSessions.map((session) => (
              <Link
                key={`${session.repoId}-${session.id}`}
                to={`/session/${session.repoId}/${session.id}`}
                className="block p-4 hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono ${
                        statusColors[session.status] || 'bg-gray-500'
                      }`}
                    >
                      {statusIcons[session.status] || '[ ]'}
                    </span>
                    <div>
                      <div className="font-medium text-white">
                        {session.repoId} #{session.issueNumber}
                      </div>
                      <div className="text-sm text-gray-400">
                        {session.issueTitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm text-gray-400">
                        {session.mode === 'ralph' && (
                          <span className="text-purple-400 mr-2">[Ralph]</span>
                        )}
                        {getElapsedTime(session.startedAt)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {session.branch}
                      </div>
                    </div>
                    {['complete', 'cancelled'].includes(session.status) && (
                      <button
                        onClick={(e) => handleDismissSession(session.repoId, session.id, e)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1"
                        title="Dismiss"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                {session.stuckReason && (
                  <div className="mt-2 text-sm text-red-400 bg-red-900/20 rounded px-2 py-1">
                    {session.stuckReason}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Spawn Dialog */}
      <SpawnDialog
        isOpen={showSpawnDialog}
        onClose={() => setShowSpawnDialog(false)}
        onSpawn={handleSpawn}
      />
    </div>
  );
}

export default Dashboard;
