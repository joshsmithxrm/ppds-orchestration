import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import SpawnDialog from '../components/SpawnDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { useSoundsContext, useConfigContext } from '../App';
import { statusColors, statusIcons } from '../constants/status';

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

interface OrphanedWorktree {
  repoId: string;
  worktreePath: string;
  branchName?: string;
  issueNumber?: number;
  sessionId?: string;
  detectedAt: string;
  contextError?: string;
}

interface DeletionState {
  repoId: string;
  sessionId: string;
  showForceOption?: boolean;
  error?: string;
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
  const [confirmDismiss, setConfirmDismiss] = useState<DeletionState | null>(null);
  const [confirmClearCompleted, setConfirmClearCompleted] = useState(false);
  const [clearingCompleted, setClearingCompleted] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [retryingDelete, setRetryingDelete] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<OrphanedWorktree[]>([]);
  const [cleaningOrphan, setCleaningOrphan] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(true);
  const [, setTick] = useState(0); // Force re-render for elapsed time updates
  const sounds = useSoundsContext();
  const config = useConfigContext();
  const prevSessionsRef = useRef<Map<string, string>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);

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
    if (session.mode === 'autonomous' && config?.sounds?.muteRalph) return false;
    return true;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionsRes, reposRes, orphansRes] = await Promise.all([
          fetch('/api/sessions?includeCompleted=true'),
          fetch('/api/repos'),
          fetch('/api/sessions/orphans'),
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

        // Load orphans (non-fatal if it fails)
        if (orphansRes.ok) {
          const orphansData = await orphansRes.json();
          setOrphans(orphansData.orphans || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Set up WebSocket for real-time updates with reconnection
    const connectWebSocket = () => {
      const ws = new WebSocket(`ws://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        reconnectAttemptRef.current = 0;
      };

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
        } else if (data.type === 'orphans:detected' && data.orphans) {
          setOrphans(data.orphans);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        // Reconnect with exponential backoff (max 30 seconds)
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        reconnectAttemptRef.current++;
        setTimeout(connectWebSocket, delay);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnection on unmount
        wsRef.current.close();
      }
    };
  }, [sounds, config]);

  // Update elapsed time display every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

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
    mode: 'manual' | 'autonomous',
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

  const handleDismissClick = (repoId: string, sessionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDismiss({ repoId, sessionId });
  };

  const handleConfirmDismiss = async (force?: boolean) => {
    if (!confirmDismiss) return;
    const { repoId, sessionId } = confirmDismiss;
    setDismissing(true);
    try {
      const url = new URL(`/api/sessions/${repoId}/${sessionId}`, window.location.origin);
      if (force) url.searchParams.set('force', 'true');

      const res = await fetch(url.toString(), { method: 'DELETE' });
      const data = await res.json();

      if (res.ok) {
        setSessions((prev) =>
          prev.filter((s) => !(s.id === sessionId && s.repoId === repoId))
        );
        setConfirmDismiss(null);
      } else if (data.deletionFailed) {
        // Show force delete option
        setConfirmDismiss({
          repoId,
          sessionId,
          showForceOption: true,
          error: data.error,
        });
      }
    } catch (err) {
      console.error('Failed to dismiss session:', err);
      setConfirmDismiss(null);
    } finally {
      setDismissing(false);
    }
  };

  const handleRetryDelete = async (repoId: string, sessionId: string) => {
    setRetryingDelete(sessionId);
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}/retry-delete`, {
        method: 'PATCH',
      });
      if (res.ok) {
        setSessions((prev) =>
          prev.filter((s) => !(s.id === sessionId && s.repoId === repoId))
        );
      }
    } catch (err) {
      console.error('Failed to retry deletion:', err);
    } finally {
      setRetryingDelete(null);
    }
  };

  const handleRollbackDelete = async (repoId: string, sessionId: string) => {
    setRollingBack(sessionId);
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}/rollback-delete`, {
        method: 'PATCH',
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId && s.repoId === repoId
              ? { ...s, ...data.session }
              : s
          )
        );
      }
    } catch (err) {
      console.error('Failed to rollback deletion:', err);
    } finally {
      setRollingBack(null);
    }
  };

  const handleCleanupOrphan = async (repoId: string, worktreePath: string) => {
    setCleaningOrphan(worktreePath);
    try {
      const res = await fetch(`/api/sessions/orphans/${repoId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktreePath }),
      });
      if (res.ok) {
        setOrphans((prev) => prev.filter((o) => o.worktreePath !== worktreePath));
      }
    } catch (err) {
      console.error('Failed to cleanup orphan:', err);
    } finally {
      setCleaningOrphan(null);
    }
  };

  const handleClearCompletedClick = () => {
    setConfirmClearCompleted(true);
  };

  const handleConfirmClearCompleted = async () => {
    setClearingCompleted(true);
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
    setClearingCompleted(false);
    setConfirmClearCompleted(false);
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
    return category !== null && activeFilters.has(category);
  });

  return (
    <div className="space-y-6">
      {/* Connection Warning */}
      {!wsConnected && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg px-4 py-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-yellow-300 text-sm">
            Live updates disconnected. Reconnecting...
          </span>
        </div>
      )}

      {/* Header with Spawn Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-white">Dashboard</h2>
          {wsConnected && (
            <span className="w-2 h-2 bg-green-500 rounded-full" title="Live updates connected" />
          )}
        </div>
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

      {/* Orphaned Worktrees Warning */}
      {orphans.length > 0 && (
        <div className="bg-orange-900/30 border border-orange-700 rounded-lg p-4">
          <h3 className="text-orange-400 font-semibold flex items-center gap-2 mb-3">
            <span>[?]</span> {orphans.length} orphaned worktree(s) detected
          </h3>
          <p className="text-sm text-orange-300 mb-3">
            These worktrees exist without corresponding session files. They may contain uncommitted work.
          </p>
          <div className="space-y-2">
            {orphans.map((orphan) => {
              const displayName = orphan.worktreePath.split(/[/\\]/).pop() || orphan.worktreePath;
              return (
                <div
                  key={orphan.worktreePath}
                  className="flex items-center justify-between bg-orange-900/20 rounded px-3 py-2"
                >
                  <div>
                    <div className="text-sm text-orange-200 font-mono">{displayName}</div>
                    {orphan.issueNumber && (
                      <div className="text-xs text-orange-400">
                        Issue: #{orphan.issueNumber}
                      </div>
                    )}
                    {orphan.branchName && (
                      <div className="text-xs text-gray-500">Branch: {orphan.branchName}</div>
                    )}
                  </div>
                  <button
                    onClick={() => handleCleanupOrphan(orphan.repoId, orphan.worktreePath)}
                    disabled={cleaningOrphan === orphan.worktreePath}
                    className="text-sm px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50 transition-colors"
                  >
                    {cleaningOrphan === orphan.worktreePath ? 'Cleaning...' : 'Cleanup'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="bg-ppds-card rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{getFilterLabel()}</h2>
          {completedCount > 0 && (
            <button
              onClick={handleClearCompletedClick}
              disabled={clearingCompleted}
              className="text-xs text-ppds-muted hover:text-white transition-colors px-2 py-1 rounded hover:bg-ppds-surface disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {clearingCompleted ? 'Clearing...' : `Clear Completed (${completedCount})`}
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
                className="block p-4 hover:bg-ppds-surface/50 transition-colors"
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
                      <div className="text-sm text-ppds-muted">
                        {session.issueTitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm text-ppds-muted">
                        {session.mode === 'autonomous' && (
                          <span className="text-ppds-ralph mr-2">[Auto]</span>
                        )}
                        {getElapsedTime(session.startedAt)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {session.branch}
                      </div>
                    </div>
                    {session.status === 'deletion_failed' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRetryDelete(session.repoId, session.id);
                          }}
                          disabled={retryingDelete === session.id || rollingBack === session.id}
                          className="text-xs px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Retry deletion"
                        >
                          {retryingDelete === session.id ? 'Retrying...' : 'Retry'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRollbackDelete(session.repoId, session.id);
                          }}
                          disabled={retryingDelete === session.id || rollingBack === session.id}
                          className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Cancel deletion"
                        >
                          {rollingBack === session.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      </div>
                    ) : ['complete', 'cancelled'].includes(session.status) && (
                      <button
                        onClick={(e) => handleDismissClick(session.repoId, session.id, e)}
                        className="text-gray-400 hover:text-red-400 hover:bg-red-900/30 transition-colors p-2 rounded"
                        title="Dismiss session"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
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

      {/* Confirm Dismiss Dialog */}
      <ConfirmDialog
        isOpen={confirmDismiss !== null}
        title={confirmDismiss?.showForceOption ? 'Deletion Failed' : 'Dismiss Session'}
        message={
          confirmDismiss?.showForceOption
            ? `Worktree cleanup failed: ${confirmDismiss.error || 'Unknown error'}. Force delete will remove the session but leave the worktree orphaned.`
            : 'Are you sure you want to dismiss this session? This will remove it from the list.'
        }
        confirmLabel={confirmDismiss?.showForceOption ? 'Force Delete' : 'Dismiss'}
        variant="danger"
        loading={dismissing}
        onConfirm={() => handleConfirmDismiss(confirmDismiss?.showForceOption)}
        onCancel={() => setConfirmDismiss(null)}
      />

      {/* Confirm Clear Completed Dialog */}
      <ConfirmDialog
        isOpen={confirmClearCompleted}
        title="Clear Completed Sessions"
        message={`Are you sure you want to clear all ${completedCount} completed session(s)? This cannot be undone.`}
        confirmLabel="Clear All"
        variant="danger"
        loading={clearingCompleted}
        onConfirm={handleConfirmClearCompleted}
        onCancel={() => setConfirmClearCompleted(false)}
      />
    </div>
  );
}

export default Dashboard;
