interface HeaderProps {
  isMockMode?: boolean;
  onSpawnClick: () => void;
}

export function Header({ isMockMode, onSpawnClick }: HeaderProps) {
  return (
    <header className="bg-dark-surface border-b border-dark-border px-4 py-3">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-dark-text">
            Orchestration Dashboard
          </h1>
          {isMockMode && (
            <span className="px-2 py-0.5 text-xs font-medium bg-yellow-900/50 text-yellow-400 border border-yellow-700 rounded">
              Dev Mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onSpawnClick}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
          >
            + Spawn Worker
          </button>
          <span className="text-sm text-dark-muted">ppds-orchestration</span>
        </div>
      </div>
    </header>
  );
}
