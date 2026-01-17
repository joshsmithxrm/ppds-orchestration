import { useEffect, useRef, useState } from 'react';

type DeletionMode = 'folder-only' | 'with-local-branch' | 'everything';

interface WorktreeState {
  uncommittedFiles: number;
  unpushedCommits: number;
  isClean: boolean;
}

interface DeleteDialogProps {
  isOpen: boolean;
  repoId: string;
  sessionId: string;
  onConfirm: (mode: DeletionMode) => void;
  onCancel: () => void;
}

export default function DeleteDialog({
  isOpen,
  repoId,
  sessionId,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<DeletionMode>('folder-only');
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      confirmButtonRef.current?.focus();
      fetchWorktreeState();
    } else {
      // Reset state when dialog closes
      setMode('folder-only');
      setWorktreeState(null);
    }
  }, [isOpen, repoId, sessionId]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onCancel]);

  const fetchWorktreeState = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${repoId}/${sessionId}/worktree-state`);
      if (res.ok) {
        const data = await res.json();
        setWorktreeState(data);
      }
    } catch (err) {
      console.error('Failed to fetch worktree state:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const hasWarnings = worktreeState && !worktreeState.isClean;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div
        className="bg-ppds-card rounded-lg p-6 w-full max-w-md border border-ppds-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="text-red-400 mt-0.5">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 id="delete-dialog-title" className="text-lg font-semibold text-white">
              Delete Session
            </h3>
          </div>
        </div>

        {/* Worktree Warnings */}
        {loading ? (
          <div className="mt-4 p-3 bg-ppds-surface rounded text-sm text-ppds-muted">
            Checking worktree state...
          </div>
        ) : hasWarnings ? (
          <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded">
            <div className="flex items-center gap-2 text-yellow-400 font-medium text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Unsaved Changes
            </div>
            <div className="mt-2 text-sm text-yellow-200 space-y-1">
              {worktreeState.uncommittedFiles > 0 && (
                <div>{worktreeState.uncommittedFiles} uncommitted file{worktreeState.uncommittedFiles > 1 ? 's' : ''}</div>
              )}
              {worktreeState.unpushedCommits > 0 && (
                <div>{worktreeState.unpushedCommits} unpushed commit{worktreeState.unpushedCommits > 1 ? 's' : ''}</div>
              )}
            </div>
          </div>
        ) : worktreeState ? (
          <div className="mt-4 p-3 bg-green-900/30 border border-green-700 rounded">
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Worktree is clean
            </div>
          </div>
        ) : null}

        {/* Deletion Mode */}
        <div className="mt-4">
          <label className="block text-sm text-ppds-muted mb-2">Deletion Mode</label>
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-2 rounded hover:bg-ppds-surface cursor-pointer">
              <input
                type="radio"
                name="deletionMode"
                value="folder-only"
                checked={mode === 'folder-only'}
                onChange={() => setMode('folder-only')}
                className="mt-0.5"
              />
              <div>
                <div className="text-white text-sm">Folder Only</div>
                <div className="text-xs text-ppds-muted">Remove worktree folder, keep branches</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-2 rounded hover:bg-ppds-surface cursor-pointer">
              <input
                type="radio"
                name="deletionMode"
                value="with-local-branch"
                checked={mode === 'with-local-branch'}
                onChange={() => setMode('with-local-branch')}
                className="mt-0.5"
              />
              <div>
                <div className="text-white text-sm">Include Local Branch</div>
                <div className="text-xs text-ppds-muted">Also delete local git branch</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-2 rounded hover:bg-ppds-surface cursor-pointer">
              <input
                type="radio"
                name="deletionMode"
                value="everything"
                checked={mode === 'everything'}
                onChange={() => setMode('everything')}
                className="mt-0.5"
              />
              <div>
                <div className="text-white text-sm">Everything</div>
                <div className="text-xs text-ppds-muted">Delete local + remote branch</div>
              </div>
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-ppds-muted hover:text-white hover:bg-ppds-surface rounded transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={() => onConfirm(mode)}
            className="px-4 py-2 font-medium rounded transition-colors bg-red-600 hover:bg-red-500 text-white"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
