import * as pty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  PtySessionConfig,
  PtySessionState,
  PtyDataCallback,
  PtyExitCallback,
} from './types.js';

/**
 * Manages PTY sessions for interactive terminal access.
 * Provides full TTY emulation for Claude Code workers.
 */
/** Maximum buffer size in bytes (100KB) */
const MAX_BUFFER_SIZE = 100 * 1024;

export class PtyManager {
  private sessions = new Map<string, {
    pty: pty.IPty;
    config: PtySessionConfig;
    logStream?: fs.WriteStream;
    createdAt: string;
    exitCode?: number;
    /** Circular buffer of recent output for late-joining clients */
    outputBuffer: string[];
    outputBufferSize: number;
  }>();

  private dataCallbacks = new Set<PtyDataCallback>();
  private exitCallbacks = new Set<PtyExitCallback>();

  /**
   * Creates a new PTY session.
   */
  async createSession(config: PtySessionConfig): Promise<PtySessionState> {
    if (this.sessions.has(config.sessionId)) {
      throw new Error(`PTY session ${config.sessionId} already exists`);
    }

    const cols = config.cols ?? 120;
    const rows = config.rows ?? 30;
    const createdAt = new Date().toISOString();

    // Set up log file if requested
    let logStream: fs.WriteStream | undefined;
    if (config.logPath) {
      const logDir = path.dirname(config.logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      logStream = fs.createWriteStream(config.logPath, { flags: 'w' });
      logStream.write(`# PTY Session Log\n`);
      logStream.write(`# Started: ${createdAt}\n`);
      logStream.write(`# Command: ${config.command} ${config.args.join(' ')}\n`);
      logStream.write(`# CWD: ${config.cwd}\n`);
      logStream.write(`${'='.repeat(60)}\n\n`);
    }

    // Determine shell based on platform
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    const useConpty = process.platform === 'win32';

    // Spawn PTY
    const ptyProcess = pty.spawn(config.command, config.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: config.cwd,
      env: {
        ...process.env,
        ...config.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
      useConpty,
    });

    // Store session with output buffer
    this.sessions.set(config.sessionId, {
      pty: ptyProcess,
      config,
      logStream,
      createdAt,
      outputBuffer: [],
      outputBufferSize: 0,
    });

    // Handle data events
    ptyProcess.onData((data: string) => {
      const session = this.sessions.get(config.sessionId);

      // Tee to log file
      if (logStream) {
        logStream.write(data);
      }

      // Buffer output for late-joining clients
      if (session) {
        session.outputBuffer.push(data);
        session.outputBufferSize += data.length;

        // Trim buffer if too large (keep last ~100KB)
        while (session.outputBufferSize > MAX_BUFFER_SIZE && session.outputBuffer.length > 1) {
          const removed = session.outputBuffer.shift();
          if (removed) {
            session.outputBufferSize -= removed.length;
          }
        }
      }

      // Notify callbacks
      for (const callback of this.dataCallbacks) {
        try {
          callback(config.sessionId, data);
        } catch (error) {
          console.error('PTY data callback error:', error);
        }
      }
    });

    // Handle exit events
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      const session = this.sessions.get(config.sessionId);
      if (session) {
        session.exitCode = exitCode;
      }

      // Write exit to log
      if (logStream) {
        logStream.write(`\n\n${'='.repeat(60)}\n`);
        logStream.write(`# Process exited with code: ${exitCode}\n`);
        logStream.write(`# Ended: ${new Date().toISOString()}\n`);
        logStream.end();
      }

      // Notify callbacks
      for (const callback of this.exitCallbacks) {
        try {
          callback(config.sessionId, exitCode);
        } catch (error) {
          console.error('PTY exit callback error:', error);
        }
      }
    });

    return {
      sessionId: config.sessionId,
      pid: ptyProcess.pid,
      running: true,
      createdAt,
      cols,
      rows,
    };
  }

  /**
   * Writes data to a PTY session's stdin.
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`PTY session ${sessionId} not found`);
    }
    session.pty.write(data);
  }

  /**
   * Resizes a PTY session.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`PTY session ${sessionId} not found`);
    }
    session.pty.resize(cols, rows);
  }

  /**
   * Gets the state of a PTY session.
   */
  getState(sessionId: string): PtySessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      sessionId,
      pid: session.pty.pid,
      running: session.exitCode === undefined,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      cols: session.config.cols ?? 120,
      rows: session.config.rows ?? 30,
    };
  }

  /**
   * Kills a PTY session.
   */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.pty.kill();
  }

  /**
   * Destroys a PTY session and cleans up resources.
   */
  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Kill if still running
    if (session.exitCode === undefined) {
      session.pty.kill();
    }

    // Close log stream
    if (session.logStream) {
      session.logStream.end();
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Lists all active PTY sessions.
   */
  listSessions(): PtySessionState[] {
    const states: PtySessionState[] = [];
    for (const sessionId of this.sessions.keys()) {
      const state = this.getState(sessionId);
      if (state) {
        states.push(state);
      }
    }
    return states;
  }

  /**
   * Registers a callback for PTY data events.
   */
  onData(callback: PtyDataCallback): () => void {
    this.dataCallbacks.add(callback);
    return () => this.dataCallbacks.delete(callback);
  }

  /**
   * Registers a callback for PTY exit events.
   */
  onExit(callback: PtyExitCallback): () => void {
    this.exitCallbacks.add(callback);
    return () => this.exitCallbacks.delete(callback);
  }

  /**
   * Checks if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Gets the log path for a session if configured.
   */
  getLogPath(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.config.logPath;
  }

  /**
   * Gets the buffered output for a session.
   * Used to send recent history to late-joining clients.
   */
  getBuffer(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return session.outputBuffer.join('');
  }

  /**
   * Destroys all sessions (for cleanup).
   */
  destroyAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.destroy(sessionId);
    }
  }
}

/**
 * Singleton instance for sharing across the application.
 */
let sharedPtyManager: PtyManager | undefined;

/**
 * Gets the shared PTY manager instance.
 */
export function getSharedPtyManager(): PtyManager {
  if (!sharedPtyManager) {
    sharedPtyManager = new PtyManager();
  }
  return sharedPtyManager;
}
