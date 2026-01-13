import { spawn } from 'node:child_process';

/**
 * Information about a tracked process.
 */
export interface TrackedProcess {
  pid: number;
  sessionId: string;
  repoId: string;
  startedAt: string;
}

/**
 * Callback for process exit events.
 */
export type ProcessExitCallback = (
  process: TrackedProcess,
  exitCode: number | null
) => void;

/**
 * Tracks worker processes for Ralph loop.
 * Uses polling-based process existence check.
 */
export class ProcessTracker {
  private tracked: Map<number, TrackedProcess> = new Map();
  private callbacks: ProcessExitCallback[] = [];
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 3000;

  /**
   * Start tracking a process.
   */
  track(pid: number, sessionId: string, repoId: string): void {
    this.tracked.set(pid, {
      pid,
      sessionId,
      repoId,
      startedAt: new Date().toISOString(),
    });

    this.startPolling();
  }

  /**
   * Stop tracking a process.
   */
  untrack(pid: number): void {
    this.tracked.delete(pid);

    if (this.tracked.size === 0) {
      this.stopPolling();
    }
  }

  /**
   * Register callback for process exit.
   */
  onExit(callback: ProcessExitCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove an exit callback.
   */
  offExit(callback: ProcessExitCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Get all tracked processes.
   */
  getTracked(): TrackedProcess[] {
    return Array.from(this.tracked.values());
  }

  /**
   * Get tracked process by session ID.
   */
  getBySession(repoId: string, sessionId: string): TrackedProcess | undefined {
    for (const proc of this.tracked.values()) {
      if (proc.repoId === repoId && proc.sessionId === sessionId) {
        return proc;
      }
    }
    return undefined;
  }

  /**
   * Check if a specific process is running.
   */
  async isRunning(pid: number): Promise<boolean> {
    if (process.platform === 'win32') {
      return this.isRunningWindows(pid);
    }
    // Unix: use kill -0
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Windows-specific process check using tasklist.
   */
  private async isRunningWindows(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
        stdio: 'pipe',
      });

      let stdout = '';
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', () => {
        // tasklist returns the process info if found
        // or "INFO: No tasks are running..." if not
        resolve(stdout.includes(pid.toString()) && !stdout.includes('INFO:'));
      });

      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Start polling for process status.
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      this.checkProcesses();
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop polling.
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Check all tracked processes and emit exit events.
   */
  private async checkProcesses(): Promise<void> {
    for (const [pid, info] of this.tracked) {
      const running = await this.isRunning(pid);

      if (!running) {
        // Process exited
        this.tracked.delete(pid);
        this.emit(info, null);
      }
    }

    // Stop polling if no more processes
    if (this.tracked.size === 0) {
      this.stopPolling();
    }
  }

  /**
   * Emit exit event to all callbacks.
   */
  private emit(process: TrackedProcess, exitCode: number | null): void {
    for (const callback of this.callbacks) {
      try {
        callback(process, exitCode);
      } catch (error) {
        console.error('ProcessTracker callback error:', error);
      }
    }
  }

  /**
   * Stop tracking all processes and clean up.
   */
  dispose(): void {
    this.stopPolling();
    this.tracked.clear();
    this.callbacks = [];
  }
}
