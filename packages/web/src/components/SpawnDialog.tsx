import { useState, useEffect } from 'react';

interface Repo {
  id: string;
  config: {
    path: string;
    defaultMode?: 'single' | 'ralph';
  };
}

interface SpawnDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (repoId: string, issueNumber: number, mode: 'single' | 'ralph', iterations?: number) => Promise<void>;
}

function SpawnDialog({ isOpen, onClose, onSpawn }: SpawnDialogProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [issueNumber, setIssueNumber] = useState<string>('');
  const [mode, setMode] = useState<'single' | 'ralph'>('single');
  const [iterations, setIterations] = useState<string>('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchRepos();
      setError(null);
    }
  }, [isOpen]);

  const fetchRepos = async () => {
    try {
      const res = await fetch('/api/repos');
      const data = await res.json();
      setRepos(data.repos || []);
      if (data.repos?.length > 0 && !selectedRepo) {
        setSelectedRepo(data.repos[0].id);
        setMode(data.repos[0].config.defaultMode || 'single');
      }
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedRepo || !issueNumber) {
      setError('Please select a repo and enter an issue number');
      return;
    }

    const issueNum = parseInt(issueNumber, 10);
    if (isNaN(issueNum) || issueNum <= 0) {
      setError('Please enter a valid issue number');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const iterNum = mode === 'ralph' ? parseInt(iterations, 10) : undefined;
      await onSpawn(selectedRepo, issueNum, mode, iterNum);
      setIssueNumber('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to spawn worker');
    } finally {
      setLoading(false);
    }
  };

  const handleRepoChange = (repoId: string) => {
    setSelectedRepo(repoId);
    const repo = repos.find(r => r.id === repoId);
    if (repo?.config.defaultMode) {
      setMode(repo.config.defaultMode);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-ppds-card rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 className="text-xl font-bold text-white mb-4">Spawn Worker</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Repo Dropdown */}
          <div>
            <label className="block text-sm text-ppds-muted mb-1">Repository</label>
            <select
              value={selectedRepo}
              onChange={(e) => handleRepoChange(e.target.value)}
              className="w-full bg-ppds-bg border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-ppds-accent"
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.id}
                </option>
              ))}
            </select>
          </div>

          {/* Issue Number Input */}
          <div>
            <label className="block text-sm text-ppds-muted mb-1">Issue Number</label>
            <input
              type="number"
              value={issueNumber}
              onChange={(e) => setIssueNumber(e.target.value)}
              placeholder="123"
              min="1"
              className="w-full bg-ppds-bg border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-ppds-accent"
            />
          </div>

          {/* Mode Toggle */}
          <div>
            <label className="block text-sm text-ppds-muted mb-2">Execution Mode</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  mode === 'single'
                    ? 'bg-ppds-accent text-ppds-bg'
                    : 'bg-ppds-bg text-ppds-muted hover:bg-gray-700'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setMode('ralph')}
                className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  mode === 'ralph'
                    ? 'bg-purple-600 text-white'
                    : 'bg-ppds-bg text-ppds-muted hover:bg-gray-700'
                }`}
              >
                Ralph
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {mode === 'single'
                ? 'Worker runs autonomously until PR is created'
                : 'Worker completes one task per iteration, re-spawned automatically'}
            </p>
          </div>

          {/* Ralph Iterations (only shown when Ralph mode is selected) */}
          {mode === 'ralph' && (
            <div>
              <label className="block text-sm text-ppds-muted mb-1">Iterations</label>
              <input
                type="number"
                value={iterations}
                onChange={(e) => setIterations(e.target.value)}
                placeholder="10"
                min="1"
                max="100"
                className="w-full bg-ppds-bg border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Number of times to re-spawn the worker
              </p>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded p-2">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-ppds-muted hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || repos.length === 0}
              className="px-4 py-2 bg-ppds-accent text-ppds-bg font-medium rounded hover:bg-ppds-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Spawning...' : 'Spawn Worker'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SpawnDialog;
