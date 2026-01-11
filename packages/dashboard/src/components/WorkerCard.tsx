import { useState } from 'react';
import type { SessionState } from '../types';
import { STATUS_CONFIG } from '../types';

interface WorkerCardProps {
  session: SessionState;
  onForward: (sessionId: string, message: string) => void;
  onCancel: (sessionId: string) => void;
  highlighted?: boolean;
}

export function WorkerCard({ session, onForward, onCancel, highlighted }: WorkerCardProps) {
  const [guidanceInput, setGuidanceInput] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);

  const statusConfig = STATUS_CONFIG[session.status];
  const elapsedTime = getElapsedTime(session.startedAt);

  const handleSendGuidance = () => {
    if (guidanceInput.trim()) {
      onForward(session.id, guidanceInput.trim());
      setGuidanceInput('');
      setShowGuidance(false);
    }
  };

  return (
    <div
      className={`
        rounded-lg border p-4 transition-colors
        ${highlighted
          ? 'border-red-700 bg-red-900/20'
          : 'border-dark-border bg-dark-surface hover:border-dark-muted'}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-dark-muted">#{session.issueNumber}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${statusConfig.bgColor} ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
          </div>
          <h3 className="text-sm font-medium text-dark-text mt-1 line-clamp-2">
            {session.issueTitle}
          </h3>
        </div>
      </div>

      {/* Status Details */}
      <div className="text-xs text-dark-muted space-y-1 mb-3">
        <div className="flex items-center gap-2">
          <span>Elapsed:</span>
          <span className="text-dark-text">{elapsedTime}</span>
        </div>

        {session.worktreeStatus && (
          <div className="flex items-center gap-2">
            <span>Changes:</span>
            <span className="text-dark-text">
              {session.worktreeStatus.filesChanged} files
              <span className="text-green-400 ml-1">+{session.worktreeStatus.insertions}</span>
              <span className="text-red-400 ml-1">-{session.worktreeStatus.deletions}</span>
            </span>
          </div>
        )}

        {session.worktreeStatus?.lastCommitMessage && (
          <div className="flex items-center gap-2">
            <span>Last commit:</span>
            <span className="text-dark-text truncate">{session.worktreeStatus.lastCommitMessage}</span>
          </div>
        )}
      </div>

      {/* Stuck Reason */}
      {session.status === 'stuck' && session.stuckReason && (
        <div className="text-xs bg-red-900/30 text-red-300 rounded p-2 mb-3">
          <strong>Reason:</strong> {session.stuckReason}
        </div>
      )}

      {/* Forwarded Message */}
      {session.forwardedMessage && (
        <div className="text-xs bg-blue-900/30 text-blue-300 rounded p-2 mb-3">
          <strong>Guidance:</strong> {session.forwardedMessage}
        </div>
      )}

      {/* PR Link */}
      {session.pullRequestUrl && (
        <a
          href={session.pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 mb-3 block"
        >
          View Pull Request
        </a>
      )}

      {/* Guidance Input (for stuck workers) */}
      {session.status === 'stuck' && (
        <div className="mt-3 pt-3 border-t border-dark-border">
          {showGuidance ? (
            <div className="space-y-2">
              <input
                type="text"
                value={guidanceInput}
                onChange={(e) => setGuidanceInput(e.target.value)}
                placeholder="Enter guidance for the worker..."
                className="w-full text-xs bg-dark-bg border border-dark-border rounded px-2 py-1.5 text-dark-text placeholder:text-dark-muted focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSendGuidance()}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSendGuidance}
                  className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-1"
                >
                  Send
                </button>
                <button
                  onClick={() => setShowGuidance(false)}
                  className="text-xs text-dark-muted hover:text-dark-text px-2 py-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowGuidance(true)}
              className="w-full text-xs bg-dark-bg hover:bg-dark-border text-dark-text rounded px-2 py-1.5 transition-colors"
            >
              Send Guidance
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 pt-3 border-t border-dark-border flex gap-2">
        <button
          onClick={() => onCancel(session.id)}
          className="text-xs text-dark-muted hover:text-red-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Calculate elapsed time from start date
 */
function getElapsedTime(startedAt: string): string {
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) {
    return `${diffMins}m`;
  }

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}
