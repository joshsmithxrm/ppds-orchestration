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

  // Fit terminal when container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      fit();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [fit, containerRef]);

  return (
    <div className={`flex flex-col bg-[#1a1a1a] rounded-lg overflow-hidden ${className}`}>
      {/* Status bar */}
      {showStatus && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs">
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
      <div className="px-3 py-1 bg-gray-800 border-t border-gray-700 text-xs text-gray-500">
        Click to focus. Type to send input to the session.
      </div>
    </div>
  );
}

export default Terminal;
