import { useState, useEffect } from 'react';

interface RalphIteration {
  iteration: number;
  startedAt: string;
  endedAt?: string;
  exitType: 'clean' | 'abnormal' | 'running';
  doneSignalDetected: boolean;
  statusAtEnd?: string;
}

interface RalphLoopState {
  repoId: string;
  sessionId: string;
  config: {
    maxIterations: number;
    iterationDelayMs: number;
  };
  currentIteration: number;
  state: 'running' | 'waiting' | 'done' | 'stuck' | 'paused';
  iterations: RalphIteration[];
  consecutiveFailures: number;
  lastChecked?: string;
}

interface RalphStatusProps {
  repoId: string;
  sessionId: string;
}

const stateColors: Record<string, string> = {
  running: 'text-green-400',
  waiting: 'text-yellow-400',
  done: 'text-blue-400',
  stuck: 'text-red-400',
  paused: 'text-gray-400',
};

const stateLabels: Record<string, string> = {
  running: 'Running',
  waiting: 'Waiting',
  done: 'Complete',
  stuck: 'Stuck',
  paused: 'Paused',
};

function RalphStatus({ repoId, sessionId }: RalphStatusProps) {
  const [state, setState] = useState<RalphLoopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
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
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-2">Ralph Loop</h3>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-2">Ralph Loop</h3>
        <p className="text-gray-400 mb-3">No active Ralph loop for this session.</p>
        <button
          onClick={handleStart}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors text-sm"
        >
          Start Ralph Loop
        </button>
      </div>
    );
  }

  const progressPercent = Math.round(
    (state.currentIteration / state.config.maxIterations) * 100
  );

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Ralph Loop</h3>
        <span
          className={`font-medium px-2 py-0.5 rounded text-sm ${
            stateColors[state.state] || 'text-gray-400'
          }`}
        >
          {stateLabels[state.state] || state.state}
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
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-purple-500 h-2 rounded-full transition-all duration-300"
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
                  className="flex items-center justify-between text-xs bg-gray-700/50 rounded px-2 py-1"
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
          className="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-50 transition-colors"
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
