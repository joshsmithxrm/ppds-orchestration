import { useEffect, useRef, useCallback, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

interface UseTerminalOptions {
  /** Session/spawn ID to connect to */
  sessionId: string;
  /** Whether to auto-connect on mount */
  autoConnect?: boolean;
  /** Callback when terminal connects */
  onConnect?: () => void;
  /** Callback when terminal disconnects */
  onDisconnect?: () => void;
  /** Callback when terminal exits */
  onExit?: (exitCode: number) => void;
}

interface UseTerminalReturn {
  /** Ref to attach to the terminal container div */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Whether currently connected to the PTY */
  connected: boolean;
  /** Whether the PTY process has exited */
  exited: boolean;
  /** Exit code if exited */
  exitCode?: number;
  /** Connect to the terminal session */
  connect: () => void;
  /** Disconnect from the terminal session */
  disconnect: () => void;
  /** Write data to the terminal */
  write: (data: string) => void;
  /** Fit the terminal to its container */
  fit: () => void;
  /** Error message if any */
  error: string | null;
}

/**
 * Hook for managing a terminal connection to a PTY session.
 */
export function useTerminal(options: UseTerminalOptions): UseTerminalReturn {
  const { sessionId, autoConnect = true, onConnect, onDisconnect, onExit } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);

  // Initialize terminal on mount
  useEffect(() => {
    // Local flag scoped to this effect invocation (not shared across StrictMode re-runs)
    let isCancelled = false;

    if (!containerRef.current) return;

    // Dynamically import xterm to avoid SSR issues
    const initTerminal = async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');

      // Import CSS
      await import('@xterm/xterm/css/xterm.css');

      // Check if effect was cleaned up during async imports (StrictMode race condition)
      if (isCancelled || !containerRef.current) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
        theme: {
          background: '#1a1a1a',
          foreground: '#e0e0e0',
          cursor: '#f0f0f0',
          cursorAccent: '#1a1a1a',
          selectionBackground: '#44475a',
          black: '#21222c',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#f8f8f2',
          brightBlack: '#6272a4',
          brightRed: '#ff6e6e',
          brightGreen: '#69ff94',
          brightYellow: '#ffffa5',
          brightBlue: '#d6acff',
          brightMagenta: '#ff92df',
          brightCyan: '#a4ffff',
          brightWhite: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      terminal.open(containerRef.current!);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Handle window resize
      const handleResize = () => {
        fitAddon.fit();
        // Send resize to server if connected
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'terminal:resize',
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          }));
        }
      };

      window.addEventListener('resize', handleResize);

      // Handle user input
      terminal.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'terminal:input',
            sessionId,
            data,
          }));
        }
      });

      // Auto-connect if requested
      if (autoConnect) {
        connectToServer();
      }

      return () => {
        window.removeEventListener('resize', handleResize);
        terminal.dispose();
      };
    };

    initTerminal();

    return () => {
      // Mark this effect invocation as cancelled to prevent async initTerminal from attaching
      isCancelled = true;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const connectToServer = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Request connection to the terminal session
      ws.send(JSON.stringify({
        type: 'terminal:connect',
        sessionId,
        cols: terminalRef.current?.cols ?? 120,
        rows: terminalRef.current?.rows ?? 30,
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('[Terminal] WS message:', message.type, message.sessionId?.slice(0, 8));

      switch (message.type) {
        case 'terminal:connected':
          console.log('[Terminal] Connected to session', sessionId.slice(0, 8));
          setConnected(true);
          setError(null);
          if (message.state?.exitCode !== undefined) {
            setExited(true);
            setExitCode(message.state.exitCode);
          }
          onConnect?.();
          break;

        case 'terminal:data':
          console.log('[Terminal] Data for', message.sessionId?.slice(0, 8), 'our session:', sessionId.slice(0, 8), 'match:', message.sessionId === sessionId, 'terminal:', !!terminalRef.current);
          if (message.sessionId === sessionId && terminalRef.current) {
            console.log('[Terminal] Writing', message.data.length, 'bytes to terminal');
            const term = terminalRef.current;
            // Check if user is at/near bottom before writing (within 5 rows)
            const buffer = term.buffer.active;
            const atBottom = buffer.viewportY >= buffer.baseY - 5;

            term.write(message.data);

            // Only auto-scroll if user was already at bottom
            if (atBottom) {
              term.scrollToBottom();
            }
          }
          break;

        case 'terminal:exit':
          if (message.sessionId === sessionId) {
            setExited(true);
            setExitCode(message.exitCode);
            onExit?.(message.exitCode);
            terminalRef.current?.write(`\r\n\x1b[33m[Process exited with code ${message.exitCode}]\x1b[0m\r\n`);
          }
          break;

        case 'terminal:error':
          if (message.sessionId === sessionId) {
            setError(message.error);
            terminalRef.current?.write(`\r\n\x1b[31m[Error: ${message.error}]\x1b[0m\r\n`);
          }
          break;
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
    };

    ws.onclose = () => {
      setConnected(false);
      onDisconnect?.();
    };
  }, [sessionId, onConnect, onDisconnect, onExit]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal:disconnect',
        sessionId,
      }));
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, [sessionId]);

  const write = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'terminal:input',
        sessionId,
        data,
      }));
    }
  }, [sessionId]);

  const fit = useCallback(() => {
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
      // Notify server of new dimensions
      if (wsRef.current?.readyState === WebSocket.OPEN && terminalRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'terminal:resize',
          sessionId,
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        }));
      }
    }
  }, [sessionId]);

  return {
    containerRef,
    connected,
    exited,
    exitCode,
    connect: connectToServer,
    disconnect,
    write,
    fit,
    error,
  };
}
