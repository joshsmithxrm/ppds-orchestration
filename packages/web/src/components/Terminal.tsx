import { useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';

interface TerminalProps {
  /** Session/spawn ID to connect to */
  sessionId: string;
  /** CSS class name for the container */
  className?: string;
  /** Callback when the terminal process exits */
  onExit?: (exitCode: number) => void;
  /** Show connection status indicator */
  showStatus?: boolean;
}

/**
 * Interactive terminal component for viewing and interacting with a PTY session.
 */
export function Terminal({ sessionId, className = '', onExit, showStatus = true }: TerminalProps) {
  const {
    containerRef,
    connected,
    exited,
    exitCode,
    error,
    fit,
  } = useTerminal({
    sessionId,
    autoConnect: true,
    onExit,
  });

  // Fit terminal when container size changes (debounced to prevent scroll-triggered fits)
  useEffect(() => {
    if (!containerRef.current) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce fit() to avoid issues during scrolling
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        fit();
      }, 100);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [fit, containerRef]);

  return (
    <div className={`flex flex-col bg-ppds-card rounded-lg overflow-hidden ${className}`}>
      {/* Status bar */}
      {showStatus && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-ppds-surface border-b border-ppds-surface text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 font-mono">{sessionId.slice(0, 8)}...</span>
            {connected ? (
              <span className="flex items-center gap-1 text-green-400">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-yellow-400">
                <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                Connecting...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {exited && (
              <span className={`${exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                Exit: {exitCode}
              </span>
            )}
            {error && (
              <span className="text-red-400" title={error}>
                Error
              </span>
            )}
          </div>
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 p-2"
        style={{ minHeight: '300px' }}
      />

      {/* Keyboard hint */}
      <div className="px-3 py-1 bg-ppds-surface border-t border-ppds-surface text-xs text-gray-500">
        Click to focus. Type to send input to the session.
      </div>
    </div>
  );
}

export default Terminal;
