import { useState, useEffect } from 'react';
import { statusTextColors, statusLabels } from '../constants/status';

interface RalphIteration {
  iteration: number;
  startedAt: string;
  endedAt?: string;
  exitType: 'clean' | 'abnormal' | 'running';
  doneSignalDetected: boolean;
  statusAtEnd?: string;
}

interface GitOperationsConfig {
  commitAfterEach: boolean;
  pushAfterEach: boolean;
  createPrOnComplete: boolean;
}

interface GitCommitStatus {
  status: 'success' | 'no_changes' | 'failed';
  message?: string;
  iteration?: number;
}

interface GitPushStatus {
  status: 'success' | 'failed';
  message?: string;
}

interface RalphLoopState {
  repoId: string;
  sessionId: string;
  config: {
    maxIterations: number;
    iterationDelayMs: number;
    gitOperations: GitOperationsConfig;
  };
  currentIteration: number;
  state: 'running' | 'waiting' | 'done' | 'stuck' | 'paused';
  iterations: RalphIteration[];
  consecutiveFailures: number;
  lastChecked?: string;
  lastCommit?: GitCommitStatus;
  lastPush?: GitPushStatus;
}

interface RalphStatusProps {
  repoId: string;
  sessionId: string;
  compact?: boolean;
}

function RalphStatus({ repoId, sessionId, compact = false }: RalphStatusProps) {
  const [state, setState] = useState<RalphLoopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = async () => {
    try {
      const res = await fetch(`/api/ralph/${repoId}/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        setError(null);
      } else if (res.status === 404) {
        setState(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to fetch Ralph state');
      }
    } catch (err) {
      setError('Failed to fetch Ralph state');
      console.error('Failed to fetch Ralph state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, [repoId, sessionId]);

  const handleContinue = async () => {
    setContinuing(true);
    try {
      const res = await fetch(`/api/ralph/${repoId}/${sessionId}/continue`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchState();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to continue');
      }
    } catch (err) {
      setError('Failed to continue loop');
      console.error('Failed to continue:', err);
    } finally {
      setContinuing(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/ralph/${repoId}/${sessionId}/start`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchState();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to start loop');
      }
    } catch (err) {
      setError('Failed to start loop');
      console.error('Failed to start:', err);
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return compact ? (
      <p className="text-gray-400 text-sm">Loading...</p>
    ) : (
      <div className="bg-ppds-card rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-2">Ralph Loop</h3>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!state) {
    return compact ? (
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">No active Ralph loop</p>
        <button
          onClick={handleStart}
          disabled={starting}
          className="px-3 py-1 bg-ppds-ralph text-white rounded hover:bg-ppds-ralph/80 text-xs disabled:opacity-50"
        >
          {starting ? 'Starting...' : 'Start'}
        </button>
      </div>
    ) : (
      <div className="bg-ppds-card rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-2">Ralph Loop</h3>
        <p className="text-gray-400 mb-3">No active Ralph loop for this session.</p>
        <button
          onClick={handleStart}
          disabled={starting}
          className="px-4 py-2 bg-ppds-ralph text-white rounded hover:bg-ppds-ralph/80 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {starting ? 'Starting...' : 'Start Ralph Loop'}
        </button>
      </div>
    );
  }

  const progressPercent = Math.round(
    (state.currentIteration / state.config.maxIterations) * 100
  );

  // Compact view for collapsible panel
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-300">
            Iteration {state.currentIteration}/{state.config.maxIterations}
          </span>
          <span className={`text-sm ${statusTextColors[state.state] || 'text-ppds-muted'}`}>
            {statusLabels[state.state] || state.state}
          </span>
        </div>
        <div className="w-full bg-ppds-surface rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-ppds-ralph h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {state.state === 'waiting' && (
          <button
            onClick={handleContinue}
            disabled={continuing}
            className="w-full px-3 py-1 bg-ppds-ralph text-white rounded text-sm hover:bg-ppds-ralph/80 disabled:opacity-50"
          >
            {continuing ? 'Continuing...' : 'Continue'}
          </button>
        )}
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <div className="bg-ppds-card rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Ralph Loop</h3>
        <span
          className={`font-medium px-2 py-0.5 rounded text-sm ${
            statusTextColors[state.state] || 'text-ppds-muted'
          }`}
        >
          {statusLabels[state.state] || state.state}
        </span>
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex justify-between text-sm text-gray-400 mb-1">
          <span>
            Iteration {state.currentIteration} / {state.config.maxIterations}
          </span>
          <span>{progressPercent}%</span>
        </div>
        <div className="w-full bg-ppds-surface rounded-full h-2 overflow-hidden">
          <div
            className="bg-ppds-ralph h-2 rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Iteration History */}
      {state.iterations.length > 0 && (
        <div>
          <h4 className="text-sm text-gray-400 mb-2">Iteration History</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {state.iterations
              .slice()
              .reverse()
              .map((iter) => (
                <div
                  key={iter.iteration}
                  className="flex items-center justify-between text-xs bg-ppds-surface/50 rounded px-2 py-1"
                >
                  <span className="text-gray-300">#{iter.iteration}</span>
                  <span
                    className={
                      iter.exitType === 'clean'
                        ? 'text-green-400'
                        : iter.exitType === 'running'
                        ? 'text-blue-400'
                        : 'text-red-400'
                    }
                  >
                    {iter.exitType}
                  </span>
                  {iter.statusAtEnd && (
                    <span className="text-gray-400">{iter.statusAtEnd}</span>
                  )}
                  {iter.doneSignalDetected && (
                    <span className="text-emerald-400" title="Done signal detected">
                      [done]
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Git Operations */}
      {state.config.gitOperations && (
        <div>
          <h4 className="text-sm text-gray-400 mb-2">Git Operations</h4>
          <div className="bg-ppds-surface/50 rounded p-2 space-y-2">
            {/* Config */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span
                className={
                  state.config.gitOperations.commitAfterEach
                    ? 'text-green-400'
                    : 'text-gray-500'
                }
                title="Commit after each iteration"
              >
                {state.config.gitOperations.commitAfterEach ? '\u2713' : '\u2717'} commit
              </span>
              <span
                className={
                  state.config.gitOperations.pushAfterEach
                    ? 'text-green-400'
                    : 'text-gray-500'
                }
                title="Push after each iteration"
              >
                {state.config.gitOperations.pushAfterEach ? '\u2713' : '\u2717'} push
              </span>
              <span
                className={
                  state.config.gitOperations.createPrOnComplete
                    ? 'text-green-400'
                    : 'text-gray-500'
                }
                title="Create PR on completion"
              >
                {state.config.gitOperations.createPrOnComplete ? '\u2713' : '\u2717'} PR
              </span>
            </div>

            {/* Status */}
            {(state.lastCommit || state.lastPush) && (
              <div className="border-t border-gray-600 pt-2 space-y-1 text-xs">
                {state.lastCommit && (
                  <div
                    className={
                      state.lastCommit.status === 'success'
                        ? 'text-green-400'
                        : state.lastCommit.status === 'no_changes'
                        ? 'text-gray-400'
                        : 'text-red-400'
                    }
                  >
                    <span className="font-medium">Commit:</span>{' '}
                    {state.lastCommit.message}
                  </div>
                )}
                {state.lastPush && (
                  <div
                    className={
                      state.lastPush.status === 'success'
                        ? 'text-green-400'
                        : 'text-red-400'
                    }
                  >
                    <span className="font-medium">Push:</span>{' '}
                    {state.lastPush.message}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Continue Button (when waiting) */}
      {state.state === 'waiting' && (
        <button
          onClick={handleContinue}
          disabled={continuing}
          className="w-full px-4 py-2 bg-ppds-ralph text-white rounded hover:bg-ppds-ralph/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {continuing ? 'Continuing...' : 'Continue to Next Iteration'}
        </button>
      )}

      {/* Stuck Warning */}
      {state.state === 'stuck' && (
        <div className="bg-red-900/30 border border-red-700 rounded p-2 text-sm text-red-300">
          Loop is stuck. Check worker status for details. You may need to manually
          intervene or restart the loop.
        </div>
      )}

      {/* Done Message */}
      {state.state === 'done' && (
        <div className="bg-green-900/30 border border-green-700 rounded p-2 text-sm text-green-300">
          Ralph loop completed successfully after {state.currentIteration} iteration
          {state.currentIteration !== 1 ? 's' : ''}.
        </div>
      )}
    </div>
  );
}

export default RalphStatus;
