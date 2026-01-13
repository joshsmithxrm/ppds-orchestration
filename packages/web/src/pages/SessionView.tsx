import { useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import RalphStatus from '../components/RalphStatus';

interface SessionDetail {
  id: string;
  repoId: string;
  issueNumber: number;
  issueTitle: string;
  status: string;
  mode: string;
  branch: string;
  worktreePath: string;
  startedAt: string;
  lastHeartbeat: string;
  stuckReason?: string;
  forwardedMessage?: string;
  pullRequestUrl?: string;
  worktreeStatus?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    lastCommitMessage: string | null;
    changedFiles: string[];
  };
}

function SessionView() {
  const { repoId, sessionId } = useParams<{
    repoId: string;
    sessionId: string;
  }>();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/sessions/${repoId}/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          setSession(data.session);
        }
      } catch (err) {
        console.error('Failed to fetch session:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [repoId, sessionId]);

  const handleForward = async () => {
    if (!message.trim()) return;
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forward', message }),
      });
      if (res.ok) {
        setMessage('');
        // Refresh session
        const data = await res.json();
        setSession(data.session);
      }
    } catch (err) {
      console.error('Failed to forward message:', err);
    }
  };

  const handleAction = async (action: 'pause' | 'resume' | 'cancel') => {
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
      }
    } catch (err) {
      console.error(`Failed to ${action} session:`, err);
    }
  };

  if (loading) {
    return <div className="text-gray-400">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="text-red-400">
        Session not found.{' '}
        <Link to="/" className="underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/" className="text-gray-400 hover:text-white">
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold text-white">
          {session.repoId} #{session.issueNumber}
        </h1>
        <span
          className={`px-2 py-1 rounded text-sm ${
            session.status === 'stuck'
              ? 'bg-red-500'
              : session.status === 'complete'
              ? 'bg-green-500'
              : 'bg-blue-500'
          }`}
        >
          {session.status}
        </span>
        {session.mode === 'ralph' && (
          <span className="px-2 py-1 rounded text-sm bg-purple-500">Ralph</span>
        )}
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">Details</h2>
          <div>
            <div className="text-sm text-gray-400">Issue Title</div>
            <div className="text-white">{session.issueTitle}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Branch</div>
            <div className="font-mono text-sm text-cyan-400">
              {session.branch}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Worktree</div>
            <div className="font-mono text-xs text-gray-300">
              {session.worktreePath}
            </div>
          </div>
          {session.pullRequestUrl && (
            <div>
              <div className="text-sm text-gray-400">Pull Request</div>
              <a
                href={session.pullRequestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                {session.pullRequestUrl}
              </a>
            </div>
          )}
        </div>

        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">Git Status</h2>
          {session.worktreeStatus ? (
            <>
              <div className="flex gap-4 text-sm">
                <span className="text-green-400">
                  +{session.worktreeStatus.insertions}
                </span>
                <span className="text-red-400">
                  -{session.worktreeStatus.deletions}
                </span>
                <span className="text-gray-400">
                  {session.worktreeStatus.filesChanged} files
                </span>
              </div>
              {session.worktreeStatus.lastCommitMessage && (
                <div className="text-sm text-gray-300">
                  Last commit: {session.worktreeStatus.lastCommitMessage}
                </div>
              )}
              {session.worktreeStatus.changedFiles.length > 0 && (
                <div className="text-xs font-mono text-gray-400 space-y-1">
                  {session.worktreeStatus.changedFiles.slice(0, 5).map((f) => (
                    <div key={f}>{f}</div>
                  ))}
                  {session.worktreeStatus.changedFiles.length > 5 && (
                    <div>
                      ...and {session.worktreeStatus.changedFiles.length - 5}{' '}
                      more
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-gray-400">No changes yet</div>
          )}
        </div>
      </div>

      {/* Ralph Status (for ralph mode sessions) */}
      {session.mode === 'ralph' && (
        <RalphStatus repoId={repoId!} sessionId={sessionId!} />
      )}

      {/* Stuck Reason */}
      {session.stuckReason && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
          <h3 className="text-red-400 font-semibold">Stuck Reason</h3>
          <p className="text-red-300">{session.stuckReason}</p>
        </div>
      )}

      {/* Forward Message */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-white mb-3">
          Forward Message to Worker
        </h2>
        {session.forwardedMessage && (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded p-3 mb-3 text-sm">
            <span className="text-yellow-400">Pending message:</span>{' '}
            <span className="text-yellow-200">{session.forwardedMessage}</span>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Enter guidance for the worker..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleForward}
            disabled={!message.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {session.status === 'paused' ? (
          <button
            onClick={() => handleAction('resume')}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
          >
            Resume
          </button>
        ) : (
          <button
            onClick={() => handleAction('pause')}
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-500"
          >
            Pause
          </button>
        )}
        <button
          onClick={() => handleAction('cancel')}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default SessionView;
