import { useParams, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import RalphStatus from '../components/RalphStatus';
import ConfirmDialog from '../components/ConfirmDialog';
import DeleteDialog from '../components/DeleteDialog';
import Terminal from '../components/Terminal';

type DeletionMode = 'folder-only' | 'with-local-branch' | 'everything';

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

interface ForceDeleteDialogState {
  isOpen: boolean;
  error?: string;
}

type PanelType = 'details' | 'git' | 'ralph';

function SessionView() {
  const { repoId, sessionId } = useParams<{
    repoId: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [forceDeleteDialog, setForceDeleteDialog] = useState<ForceDeleteDialogState>({ isOpen: false });
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<'pause' | 'resume' | null>(null);
  const [retryingDelete, setRetryingDelete] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<PanelType | null>(null);

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

  const handleAction = async (action: 'pause' | 'resume') => {
    setActionLoading(action);
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
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (mode: DeletionMode, force?: boolean) => {
    setDeleting(true);
    try {
      const url = new URL(`/api/sessions/${repoId}/${sessionId}`, window.location.origin);
      url.searchParams.set('deletionMode', mode);
      if (force) url.searchParams.set('force', 'true');

      const res = await fetch(url.toString(), { method: 'DELETE' });
      const data = await res.json();

      if (res.ok && data.success) {
        setDeleted(true);
        setDeleteDialogOpen(false);
        setForceDeleteDialog({ isOpen: false });
        navigate('/');
      } else if (data.deletionFailed) {
        setDeleteDialogOpen(false);
        setForceDeleteDialog({
          isOpen: true,
          error: data.error,
        });
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      setDeleteDialogOpen(false);
      setForceDeleteDialog({ isOpen: false });
    } finally {
      setDeleting(false);
    }
  };

  const handleRetryDelete = async () => {
    setRetryingDelete(true);
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
    } finally {
      setRetryingDelete(false);
    }
  };

  const handleRollbackDelete = async () => {
    setRollingBack(true);
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
    } finally {
      setRollingBack(false);
    }
  };

  const togglePanel = (panel: PanelType) => {
    setExpandedPanel(expandedPanel === panel ? null : panel);
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

  const statusColor =
    session.status === 'stuck'
      ? 'bg-red-500'
      : session.status === 'complete'
      ? 'bg-green-500'
      : 'bg-blue-500';

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="text-ppds-muted hover:text-white flex-shrink-0">
            &larr;
          </Link>
          <h1 className="text-lg font-semibold text-white truncate">
            {session.repoId} #{session.issueNumber}
          </h1>
          <span className={`px-2 py-0.5 rounded text-xs flex-shrink-0 ${statusColor}`}>
            {session.status}
          </span>
          {session.mode === 'autonomous' && (
            <span className="px-2 py-0.5 rounded text-xs bg-ppds-ralph flex-shrink-0">Auto</span>
          )}
          <span className="text-xs text-ppds-muted font-mono truncate hidden sm:block">
            {session.branch}
          </span>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {session.status === 'deletion_failed' ? (
            <>
              <button
                onClick={handleRetryDelete}
                disabled={retryingDelete || rollingBack}
                className="px-3 py-1 text-sm bg-orange-600 text-white rounded hover:bg-orange-500 disabled:opacity-50"
              >
                {retryingDelete ? '...' : 'Retry'}
              </button>
              <button
                onClick={handleRollbackDelete}
                disabled={retryingDelete || rollingBack}
                className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-500 disabled:opacity-50"
              >
                {rollingBack ? '...' : 'Cancel'}
              </button>
            </>
          ) : (
            <>
              {session.status === 'paused' ? (
                <button
                  onClick={() => handleAction('resume')}
                  disabled={actionLoading !== null}
                  className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
                  title="Resume"
                >
                  {actionLoading === 'resume' ? '...' : 'Resume'}
                </button>
              ) : session.status !== 'deleting' && (
                <button
                  onClick={() => handleAction('pause')}
                  disabled={actionLoading !== null}
                  className="px-3 py-1 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-500 disabled:opacity-50"
                  title="Pause"
                >
                  {actionLoading === 'pause' ? '...' : 'Pause'}
                </button>
              )}
              {session.status !== 'deleting' ? (
                <button
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={actionLoading !== null}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50"
                  title="Delete"
                >
                  Delete
                </button>
              ) : (
                <span className="px-3 py-1 text-sm bg-orange-600 text-white rounded opacity-75">
                  Deleting...
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Stuck Reason Alert - shows at top if stuck */}
      {session.stuckReason && (
        <div className="bg-red-900/30 border border-red-700 rounded px-3 py-2 mt-3 flex-shrink-0">
          <span className="text-red-400 font-medium text-sm">Stuck: </span>
          <span className="text-red-300 text-sm">{session.stuckReason}</span>
        </div>
      )}

      {/* Terminal - fills available space */}
      {session.spawnId ? (
        <div className="flex-1 min-h-0 mt-3 bg-ppds-card rounded-lg overflow-hidden">
          <Terminal sessionId={session.spawnId} className="h-full" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 mt-3 bg-ppds-card rounded-lg flex items-center justify-center">
          <span className="text-ppds-muted">Waiting for terminal connection...</span>
        </div>
      )}

      {/* Collapsible Panels Footer */}
      <div className="flex-shrink-0 mt-3 space-y-2">
        {/* Panel Toggle Buttons */}
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => togglePanel('details')}
            className={`px-3 py-1.5 rounded transition-colors ${
              expandedPanel === 'details'
                ? 'bg-ppds-accent text-ppds-bg'
                : 'bg-ppds-card text-ppds-muted hover:text-white'
            }`}
          >
            {expandedPanel === 'details' ? '- Details' : '+ Details'}
          </button>
          <button
            onClick={() => togglePanel('git')}
            className={`px-3 py-1.5 rounded transition-colors ${
              expandedPanel === 'git'
                ? 'bg-ppds-accent text-ppds-bg'
                : 'bg-ppds-card text-ppds-muted hover:text-white'
            }`}
          >
            {expandedPanel === 'git' ? '- Git' : '+ Git'}
            {session.worktreeStatus && (
              <span className="ml-1 text-xs">
                <span className="text-green-400">+{session.worktreeStatus.insertions}</span>
                <span className="text-red-400 ml-1">-{session.worktreeStatus.deletions}</span>
              </span>
            )}
          </button>
          {session.mode === 'autonomous' && (
            <button
              onClick={() => togglePanel('ralph')}
              className={`px-3 py-1.5 rounded transition-colors ${
                expandedPanel === 'ralph'
                  ? 'bg-ppds-ralph text-white'
                  : 'bg-ppds-card text-ppds-muted hover:text-white'
              }`}
            >
              {expandedPanel === 'ralph' ? '- Ralph' : '+ Ralph'}
            </button>
          )}
        </div>

        {/* Expanded Panel Content */}
        {expandedPanel === 'details' && (
          <div className="bg-ppds-card rounded-lg p-4 space-y-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-ppds-muted">Issue: </span>
                <span className="text-white">{session.issueTitle}</span>
              </div>
              <div>
                <span className="text-ppds-muted">Branch: </span>
                <span className="font-mono text-cyan-400">{session.branch}</span>
              </div>
              <div className="col-span-2">
                <span className="text-ppds-muted">Worktree: </span>
                <span className="font-mono text-xs text-gray-300">{session.worktreePath}</span>
              </div>
              {session.pullRequestUrl && (
                <div className="col-span-2">
                  <span className="text-ppds-muted">PR: </span>
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
          </div>
        )}

        {expandedPanel === 'git' && (
          <div className="bg-ppds-card rounded-lg p-4">
            {session.worktreeStatus ? (
              <div className="space-y-2">
                <div className="flex gap-4 text-sm">
                  <span className="text-green-400">+{session.worktreeStatus.insertions}</span>
                  <span className="text-red-400">-{session.worktreeStatus.deletions}</span>
                  <span className="text-ppds-muted">{session.worktreeStatus.filesChanged} files</span>
                </div>
                {session.worktreeStatus.lastCommitMessage && (
                  <div className="text-sm text-gray-300">
                    Last commit: {session.worktreeStatus.lastCommitMessage}
                  </div>
                )}
                {session.worktreeStatus.changedFiles.length > 0 && (
                  <div className="text-xs font-mono text-ppds-muted flex flex-wrap gap-2">
                    {session.worktreeStatus.changedFiles.slice(0, 8).map((f) => (
                      <span key={f} className="bg-ppds-bg px-1 rounded">{f}</span>
                    ))}
                    {session.worktreeStatus.changedFiles.length > 8 && (
                      <span className="text-gray-500">+{session.worktreeStatus.changedFiles.length - 8} more</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-ppds-muted text-sm">No changes yet</div>
            )}
          </div>
        )}

        {expandedPanel === 'ralph' && session.mode === 'autonomous' && (
          <div className="bg-ppds-card rounded-lg p-4">
            <RalphStatus repoId={repoId!} sessionId={sessionId!} compact />
          </div>
        )}
      </div>

      {/* Delete Dialog with Mode Selection */}
      <DeleteDialog
        isOpen={deleteDialogOpen}
        repoId={repoId!}
        sessionId={sessionId!}
        deleting={deleting}
        onConfirm={(mode) => handleDelete(mode)}
        onCancel={() => setDeleteDialogOpen(false)}
      />

      {/* Force Delete Confirmation (when normal delete fails) */}
      <ConfirmDialog
        isOpen={forceDeleteDialog.isOpen}
        title="Deletion Failed"
        message={`Worktree cleanup failed: ${forceDeleteDialog.error || 'Unknown error'}. Force delete will remove the session but leave the worktree orphaned.`}
        confirmLabel="Force Delete"
        variant="danger"
        loading={deleting}
        onConfirm={() => handleDelete('folder-only', true)}
        onCancel={() => setForceDeleteDialog({ isOpen: false })}
      />
    </div>
  );
}

export default SessionView;
