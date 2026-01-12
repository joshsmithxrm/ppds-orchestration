import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

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
  complete: 'bg-green-600',
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
  complete: '[✓]',
  cancelled: '[x]',
};

function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sessionsRes, reposRes] = await Promise.all([
          fetch('/api/sessions'),
          fetch('/api/repos'),
        ]);

        if (!sessionsRes.ok || !reposRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const sessionsData = await sessionsRes.json();
        const reposData = await reposRes.json();

        setSessions(sessionsData.sessions || []);
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
      if (data.type === 'session:update') {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === data.session.id && s.repoId === data.repoId
              ? { ...s, ...data.session }
              : s
          )
        );
      }
    };

    return () => ws.close();
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
    (s) => !['complete', 'cancelled'].includes(s.status)
  ).length;
  const stuckCount = sessions.filter((s) => s.status === 'stuck').length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-3xl font-bold text-white">{repos.length}</div>
          <div className="text-sm text-gray-400">Repos</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-400">{activeCount}</div>
          <div className="text-sm text-gray-400">Active Workers</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-3xl font-bold text-red-400">{stuckCount}</div>
          <div className="text-sm text-gray-400">Stuck</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-400">
            {sessions.filter((s) => s.status === 'complete').length}
          </div>
          <div className="text-sm text-gray-400">Completed</div>
        </div>
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
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">All Sessions</h2>
        </div>
        {sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No active sessions. Spawn a worker to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {sessions.map((session) => (
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
    </div>
  );
}

export default Dashboard;
