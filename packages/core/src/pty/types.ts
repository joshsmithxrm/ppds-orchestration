/**
 * PTY session configuration.
 */
export interface PtySessionConfig {
  /** Unique identifier for the PTY session (typically the spawnId). */
  sessionId: string;

  /** Command to execute (e.g., 'claude'). */
  command: string;

  /** Arguments to pass to the command. */
  args: string[];

  /** Working directory for the PTY process. */
  cwd: string;

  /** Environment variables to set. */
  env?: Record<string, string>;

  /** Initial terminal dimensions. */
  cols?: number;
  rows?: number;

  /** Optional log file path for tee-ing output. */
  logPath?: string;
}

/**
 * PTY session state.
 */
export interface PtySessionState {
  /** Session identifier. */
  sessionId: string;

  /** Process ID if running. */
  pid: number | undefined;

  /** Whether the PTY is currently running. */
  running: boolean;

  /** Exit code if the process has exited. */
  exitCode?: number;

  /** When the session was created. */
  createdAt: string;

  /** Current terminal dimensions. */
  cols: number;
  rows: number;
}

/**
 * WebSocket terminal message types.
 */
export type TerminalMessageType =
  | 'terminal:connect'
  | 'terminal:data'
  | 'terminal:input'
  | 'terminal:resize'
  | 'terminal:disconnect'
  | 'terminal:error'
  | 'terminal:exit';

/**
 * Terminal connect request from client.
 */
export interface TerminalConnectMessage {
  type: 'terminal:connect';
  sessionId: string;
  cols?: number;
  rows?: number;
}

/**
 * Terminal data from server (stdout/stderr).
 */
export interface TerminalDataMessage {
  type: 'terminal:data';
  sessionId: string;
  data: string;
}

/**
 * Terminal input from client (stdin).
 */
export interface TerminalInputMessage {
  type: 'terminal:input';
  sessionId: string;
  data: string;
}

/**
 * Terminal resize request from client.
 */
export interface TerminalResizeMessage {
  type: 'terminal:resize';
  sessionId: string;
  cols: number;
  rows: number;
}

/**
 * Terminal disconnect request.
 */
export interface TerminalDisconnectMessage {
  type: 'terminal:disconnect';
  sessionId: string;
}

/**
 * Terminal error from server.
 */
export interface TerminalErrorMessage {
  type: 'terminal:error';
  sessionId: string;
  error: string;
}

/**
 * Terminal exit notification from server.
 */
export interface TerminalExitMessage {
  type: 'terminal:exit';
  sessionId: string;
  exitCode: number;
}

/**
 * All terminal message types.
 */
export type TerminalMessage =
  | TerminalConnectMessage
  | TerminalDataMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalDisconnectMessage
  | TerminalErrorMessage
  | TerminalExitMessage;

/**
 * Callback for PTY data events.
 */
export type PtyDataCallback = (sessionId: string, data: string) => void;

/**
 * Callback for PTY exit events.
 */
export type PtyExitCallback = (sessionId: string, exitCode: number) => void;
