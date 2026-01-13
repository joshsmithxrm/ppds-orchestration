import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface RepoConfig {
  path: string;
  githubOwner?: string;
  githubRepo?: string;
  baseBranch?: string;
  worktreePrefix?: string;
  defaultMode?: 'single' | 'ralph';
  cliCommand?: string;
}

interface HookConfig {
  type: 'command' | 'prompt';
  value: string;
}

interface CentralConfig {
  version: string;
  repos: Record<string, RepoConfig>;
  hooks?: Record<string, HookConfig>;
  sounds?: {
    onSpawn?: string;
    onStuck?: string;
    onComplete?: string;
  };
  ralph?: {
    maxIterations: number;
    iterationDelayMs: number;
    doneSignal?: {
      type: string;
      value: string;
    };
  };
  dashboard?: {
    port: number;
  };
  cliCommand: string;
}

function Settings() {
  const [config, setConfig] = useState<CentralConfig | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [rawJson, setRawJson] = useState('');

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data.config);
      setConfigPath(data.path || '~/.orchestration/config.json');
      setRawJson(JSON.stringify(data.config, null, 2));
      setError(null);
    } catch (err) {
      setError('Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const parsed = JSON.parse(rawJson);

      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save');
      }

      setConfig(data.config);
      setRawJson(JSON.stringify(data.config, null, 2));
      setSuccess('Config saved successfully. Note: Server restart may be required for some changes.');
      setEditMode(false);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON syntax');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save config');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditMode(false);
    setRawJson(JSON.stringify(config, null, 2));
    setError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-white">
            &larr; Back
          </Link>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        {!editMode ? (
          <button
            onClick={() => setEditMode(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
          >
            Edit Config
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Config Path */}
      <div className="text-sm text-gray-400">
        Config file:{' '}
        <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
          {configPath}
        </code>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/30 border border-green-700 rounded p-3 text-green-300">
          {success}
        </div>
      )}

      {/* Config View/Edit */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        {editMode ? (
          <div className="relative">
            <div className="absolute top-2 right-2 text-xs text-gray-500">
              JSON Editor
            </div>
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="w-full h-[600px] bg-gray-900 text-gray-100 font-mono text-sm p-4 focus:outline-none border-none resize-none"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {/* Repos Section */}
            <div className="p-4">
              <h2 className="text-lg font-semibold text-white mb-3">
                Repositories
              </h2>
              {config && Object.keys(config.repos).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(config.repos).map(([id, repo]) => (
                    <div
                      key={id}
                      className="bg-gray-700/50 rounded p-3 space-y-1"
                    >
                      <div className="font-medium text-white">{id}</div>
                      <div className="text-sm text-gray-400 font-mono">
                        {repo.path}
                      </div>
                      {repo.githubOwner && repo.githubRepo && (
                        <div className="text-sm text-gray-400">
                          GitHub: {repo.githubOwner}/{repo.githubRepo}
                        </div>
                      )}
                      {repo.defaultMode && (
                        <div className="text-sm">
                          <span className="text-gray-500">Default mode:</span>{' '}
                          <span
                            className={
                              repo.defaultMode === 'ralph'
                                ? 'text-purple-400'
                                : 'text-blue-400'
                            }
                          >
                            {repo.defaultMode}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-400">No repositories configured.</div>
              )}
            </div>

            {/* Hooks Section */}
            {config?.hooks && Object.keys(config.hooks).length > 0 && (
              <div className="p-4">
                <h2 className="text-lg font-semibold text-white mb-3">
                  Global Hooks
                </h2>
                <div className="space-y-2">
                  {Object.entries(config.hooks).map(([name, hook]) => (
                    <div key={name} className="text-sm">
                      <span className="text-cyan-400">{name}</span>
                      <span className="text-gray-500 mx-2">
                        ({hook.type})
                      </span>
                      <code className="text-gray-300 text-xs bg-gray-700 px-2 py-0.5 rounded">
                        {hook.value.length > 60
                          ? hook.value.slice(0, 60) + '...'
                          : hook.value}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sounds Section */}
            {config?.sounds && Object.keys(config.sounds).length > 0 && (
              <div className="p-4">
                <h2 className="text-lg font-semibold text-white mb-3">
                  Sound Notifications
                </h2>
                <div className="space-y-2">
                  {Object.entries(config.sounds).map(([event, url]) => (
                    <div key={event} className="text-sm flex items-center gap-2">
                      <span className="text-purple-400 w-24">{event}:</span>
                      <code className="text-gray-400 text-xs truncate flex-1">
                        {url}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ralph Config */}
            {config?.ralph && (
              <div className="p-4">
                <h2 className="text-lg font-semibold text-white mb-3">
                  Ralph Loop
                </h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Max iterations:</span>{' '}
                    <span className="text-white">
                      {config.ralph.maxIterations}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Iteration delay:</span>{' '}
                    <span className="text-white">
                      {config.ralph.iterationDelayMs}ms
                    </span>
                  </div>
                  {config.ralph.doneSignal && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Done signal:</span>{' '}
                      <span className="text-white">
                        {config.ralph.doneSignal.type} ={' '}
                        {config.ralph.doneSignal.value}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Dashboard Config */}
            {config?.dashboard && (
              <div className="p-4">
                <h2 className="text-lg font-semibold text-white mb-3">
                  Dashboard
                </h2>
                <div className="text-sm">
                  <span className="text-gray-500">Port:</span>{' '}
                  <span className="text-white">{config.dashboard.port}</span>
                </div>
              </div>
            )}

            {/* CLI Command */}
            <div className="p-4">
              <h2 className="text-lg font-semibold text-white mb-3">
                CLI
              </h2>
              <div className="text-sm">
                <span className="text-gray-500">Command:</span>{' '}
                <code className="text-white bg-gray-700 px-2 py-0.5 rounded">
                  {config?.cliCommand || 'orch'}
                </code>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Help Text */}
      {!editMode && (
        <div className="text-sm text-gray-500">
          <p>
            Click "Edit Config" to modify the configuration. Changes to
            repositories may require a server restart to take effect.
          </p>
        </div>
      )}
    </div>
  );
}

export default Settings;
