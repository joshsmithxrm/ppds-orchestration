import { useParams, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import RalphStatus from '../components/RalphStatus';
import ConfirmDialog from '../components/ConfirmDialog';
import Terminal from '../components/Terminal';

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
  /** Spawn ID for PTY terminal connection */
  spawnId?: string;
  worktreeStatus?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    lastCommitMessage: string | null;
    changedFiles: string[];
  };
}

interface DeleteDialogState {
  isOpen: boolean;
  showForceOption?: boolean;
  error?: string;
}

function SessionView() {
  const { repoId, sessionId } = useParams<{
    repoId: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ isOpen: false });
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    if (deleted) return; // Stop polling after deletion

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

    // Poll for updates every 5 seconds for active sessions
    const interval = setInterval(fetchSession, 5000);
    return () => clearInterval(interval);
  }, [repoId, sessionId, deleted]);

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

  const handleAction = async (action: 'pause' | 'resume') => {
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

  const handleDelete = async (force?: boolean) => {
    try {
      const url = new URL(`/api/sessions/${repoId}/${sessionId}`, window.location.origin);
      if (force) url.searchParams.set('force', 'true');

      const res = await fetch(url.toString(), { method: 'DELETE' });
      const data = await res.json();

      if (res.ok && data.success) {
        setDeleted(true);
        setDeleteDialog({ isOpen: false });
        navigate('/');
      } else if (data.deletionFailed) {
        setDeleteDialog({
          isOpen: true,
          showForceOption: true,
          error: data.error,
        });
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      setDeleteDialog({ isOpen: false });
    }
  };

  const handleRetryDelete = async () => {
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}/retry-delete`, {
        method: 'PATCH',
      });
      if (res.ok) {
        setDeleted(true);
        navigate('/');
      }
    } catch (err) {
      console.error('Failed to retry deletion:', err);
    }
  };

  const handleRollbackDelete = async () => {
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}/rollback-delete`, {
        method: 'PATCH',
      });
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
      }
    } catch (err) {
      console.error('Failed to rollback deletion:', err);
    }
  };

  if (loading) {
    return <div className="text-ppds-muted">Loading...</div>;
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
        <Link to="/" className="text-ppds-muted hover:text-white">
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
        {session.mode === 'autonomous' && (
          <span className="px-2 py-1 rounded text-sm bg-ppds-ralph">Autonomous</span>
        )}
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">Details</h2>
          <div>
            <div className="text-sm text-ppds-muted">Issue Title</div>
            <div className="text-white">{session.issueTitle}</div>
          </div>
          <div>
            <div className="text-sm text-ppds-muted">Branch</div>
            <div className="font-mono text-sm text-cyan-400">
              {session.branch}
            </div>
          </div>
          <div>
            <div className="text-sm text-ppds-muted">Worktree</div>
            <div className="font-mono text-xs text-gray-300">
              {session.worktreePath}
            </div>
          </div>
          {session.pullRequestUrl && (
            <div>
              <div className="text-sm text-ppds-muted">Pull Request</div>
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
                <span className="text-ppds-muted">
                  {session.worktreeStatus.filesChanged} files
                </span>
              </div>
              {session.worktreeStatus.lastCommitMessage && (
                <div className="text-sm text-gray-300">
                  Last commit: {session.worktreeStatus.lastCommitMessage}
                </div>
              )}
              {session.worktreeStatus.changedFiles.length > 0 && (
                <div className="text-xs font-mono text-ppds-muted space-y-1">
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
            <div className="text-ppds-muted">No changes yet</div>
          )}
        </div>
      </div>

      {/* Autonomous Status (for autonomous mode sessions) */}
      {session.mode === 'autonomous' && (
        <RalphStatus repoId={repoId!} sessionId={sessionId!} />
      )}

      {/* Live Terminal (when spawnId is available) */}
      {session.spawnId && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-3">
            Live Terminal
          </h2>
          <Terminal
            sessionId={session.spawnId}
            className="h-96"
          />
        </div>
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
        {session.status === 'deletion_failed' ? (
          <>
            <button
              onClick={handleRetryDelete}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-500"
            >
              Retry Delete
            </button>
            <button
              onClick={handleRollbackDelete}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500"
            >
              Cancel Delete
            </button>
          </>
        ) : (
          <>
            {session.status === 'paused' ? (
              <button
                onClick={() => handleAction('resume')}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
              >
                Resume
              </button>
            ) : session.status !== 'deleting' && (
              <button
                onClick={() => handleAction('pause')}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-500"
              >
                Pause
              </button>
            )}
            {session.status !== 'deleting' && (
              <button
                onClick={() => setDeleteDialog({ isOpen: true })}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500"
              >
                Delete
              </button>
            )}
            {session.status === 'deleting' && (
              <span className="px-4 py-2 bg-orange-600 text-white rounded opacity-75">
                Deleting...
              </span>
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        title={deleteDialog.showForceOption ? 'Deletion Failed' : 'Delete Session'}
        message={
          deleteDialog.showForceOption
            ? `Worktree cleanup failed: ${deleteDialog.error || 'Unknown error'}. Force delete will remove the session but leave the worktree orphaned.`
            : 'Are you sure you want to delete this session? This will remove the worktree and all uncommitted changes.'
        }
        confirmLabel={deleteDialog.showForceOption ? 'Force Delete' : 'Delete'}
        variant="danger"
        onConfirm={() => handleDelete(deleteDialog.showForceOption)}
        onCancel={() => setDeleteDialog({ isOpen: false })}
      />
    </div>
  );
}

export default SessionView;
