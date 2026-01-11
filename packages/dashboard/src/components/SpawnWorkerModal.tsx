import { useState, useEffect, useRef } from 'react';

interface SpawnWorkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (issueNumber: number) => Promise<void>;
  error: string | null;
  isLoading: boolean;
}

export function SpawnWorkerModal({
  isOpen,
  onClose,
  onSpawn,
  error,
  isLoading,
}: SpawnWorkerModalProps) {
  const [issueNumber, setIssueNumber] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Clear input when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIssueNumber('');
      setValidationError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const num = parseInt(issueNumber, 10);
    if (!issueNumber.trim()) {
      setValidationError('Issue number is required');
      return;
    }
    if (isNaN(num) || num <= 0) {
      setValidationError('Issue number must be a positive integer');
      return;
    }

    await onSpawn(num);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-dark-surface border border-dark-border rounded-lg p-6 w-96 shadow-xl">
        <h2 className="text-lg font-semibold text-dark-text mb-4">Spawn Worker</h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="issueNumber" className="block text-sm text-dark-muted mb-2">
              GitHub Issue Number
            </label>
            <input
              ref={inputRef}
              id="issueNumber"
              type="number"
              min="1"
              value={issueNumber}
              onChange={(e) => {
                setIssueNumber(e.target.value);
                setValidationError(null);
              }}
              disabled={isLoading}
              placeholder="Enter issue number..."
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-dark-text placeholder:text-dark-muted focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="text-xs bg-yellow-900/30 text-yellow-300 rounded p-2 mb-4">
              {validationError}
            </div>
          )}

          {/* API Error */}
          {error && (
            <div className="text-xs bg-red-900/30 text-red-300 rounded p-2 mb-4">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Spawning...
                </>
              ) : (
                'Spawn'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="bg-dark-bg hover:bg-dark-border disabled:opacity-50 text-dark-text px-4 py-2 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
