import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WorkerSpawner, SpawnResult, SpawnInfo, WorkerStatus } from './worker-spawner.js';
import { WorkerSpawnRequest } from '../session/types.js';
import { getSharedPtyManager, PtyManager } from '../pty/pty-manager.js';

/**
 * Headless worker spawner for Windows.
 * Runs Claude Code workers as background processes with output captured to log files.
 * Process exit is the completion signal - no interactive terminal needed.
 */
export class WindowsTerminalSpawner implements WorkerSpawner {
  /**
   * Track spawned workers by spawn ID -> process info.
   */
  private runningProcesses = new Map<string, {
    process: ChildProcess;
    worktreePath: string;
    logPath: string;
  }>();

  /**
   * Track PTY spawned workers by spawn ID.
   * PTY sessions are managed by PtyManager, we just track which spawns used PTY.
   */
  private ptySpawns = new Set<string>();

  getName(): string {
    return 'Headless Spawner';
  }

  /**
   * Always available on Windows - just needs claude CLI.
   */
  isAvailable(): boolean {
    return process.platform === 'win32';
  }

  /**
   * Spawns a Claude Code worker as a headless background process.
   * Output is captured to a timestamped log file.
   */
  async spawn(request: WorkerSpawnRequest): Promise<SpawnResult> {
    const spawnId = crypto.randomUUID();
    const spawnedAt = new Date().toISOString();

    if (!this.isAvailable()) {
      return {
        success: false,
        spawnId,
        spawnedAt,
        error: 'Windows platform required',
      };
    }

    // Ensure .claude directory exists
    const claudeDir = path.join(request.workingDirectory, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Write spawn info to worktree for tracking
    const spawnInfo: SpawnInfo = {
      spawnId,
      spawnedAt,
      issueNumbers: [request.issue.number],
      iteration: request.iteration,
    };
    await this.writeSpawnInfo(request.workingDirectory, spawnInfo);

    // Write prompt to file
    const promptPath = path.join(claudeDir, 'session-prompt.md');
    await fs.promises.writeFile(promptPath, request.promptContent, 'utf-8');

    // Generate timestamped log file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const iteration = request.iteration ?? 1;
    const logFileName = `worker-${iteration}-${timestamp}.log`;
    const logPath = path.join(claudeDir, logFileName);

    // PTY mode: use PtyManager for interactive terminal access
    if (request.usePty) {
      return this.spawnWithPty(spawnId, spawnedAt, request, logPath);
    }

    // Headless mode: create log file write stream
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    // Write header to log
    logStream.write(`# Worker Log - Iteration ${iteration}\n`);
    logStream.write(`# Started: ${spawnedAt}\n`);
    logStream.write(`# Issue: #${request.issue.number}\n`);
    logStream.write(`# Worktree: ${request.workingDirectory}\n`);
    logStream.write(`${'='.repeat(60)}\n\n`);

    // Read prompt content to pipe to stdin (more reliable than cmd /c with type)
    const promptContent = request.promptContent;

    // Spawn claude directly with stdin pipe
    const command = 'claude';
    const args = ['-p', '--dangerously-skip-permissions'];

    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd: request.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],  // stdin=pipe for prompt input
        windowsHide: true,
      });

      // Write prompt to stdin and close
      proc.stdin?.write(promptContent);
      proc.stdin?.end();

      // Capture stdout to log
      proc.stdout?.on('data', (data) => {
        logStream.write(data);
      });

      // Capture stderr to log
      proc.stderr?.on('data', (data) => {
        logStream.write(data);
      });

      proc.on('error', (error) => {
        logStream.write(`\n\n# ERROR: ${error.message}\n`);
        logStream.end();
        resolve({
          success: false,
          spawnId,
          spawnedAt,
          error: `Failed to spawn worker: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        logStream.write(`\n\n${'='.repeat(60)}\n`);
        logStream.write(`# Process exited with code: ${code}\n`);
        logStream.write(`# Ended: ${new Date().toISOString()}\n`);
        logStream.end();
      });

      // Track this process for getStatus() and stop()
      this.runningProcesses.set(spawnId, {
        process: proc,
        worktreePath: request.workingDirectory,
        logPath,
      });

      // Process started successfully
      resolve({
        success: true,
        spawnId,
        spawnedAt,
      });
    });
  }

  /**
   * Stops a running worker by killing the process.
   */
  async stop(spawnId: string): Promise<void> {
    // Check if this is a PTY spawn
    if (this.ptySpawns.has(spawnId)) {
      const ptyManager = getSharedPtyManager();
      ptyManager.kill(spawnId);
      return;
    }

    const info = this.runningProcesses.get(spawnId);
    if (!info) {
      return; // Already stopped or unknown
    }

    const { process: proc } = info;

    // Kill the process tree
    if (proc.pid && !proc.killed) {
      try {
        // Use taskkill to kill process tree on Windows
        spawn('taskkill', ['/F', '/T', '/PID', proc.pid.toString()], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // Fallback to regular kill
        proc.kill('SIGTERM');
      }
    }
  }

  /**
   * Gets the current status of a worker by checking if the process has exited.
   */
  async getStatus(spawnId: string): Promise<WorkerStatus> {
    // Check if this is a PTY spawn
    if (this.ptySpawns.has(spawnId)) {
      const ptyManager = getSharedPtyManager();
      const state = ptyManager.getState(spawnId);
      if (!state) {
        return { running: false };
      }
      return {
        running: state.running,
        exitCode: state.exitCode,
      };
    }

    const info = this.runningProcesses.get(spawnId);
    if (!info) {
      // Unknown spawn - assume not running
      return { running: false };
    }

    const { process: proc } = info;

    // Check if process has exited
    if (proc.exitCode !== null) {
      return { running: false, exitCode: proc.exitCode };
    }

    // Process is still running
    return { running: true };
  }

  /**
   * Gets the log file path for a spawn.
   */
  getLogPath(spawnId: string): string | undefined {
    // Check if this is a PTY spawn
    if (this.ptySpawns.has(spawnId)) {
      const ptyManager = getSharedPtyManager();
      return ptyManager.getLogPath(spawnId);
    }
    return this.runningProcesses.get(spawnId)?.logPath;
  }

  /**
   * Spawns a worker with PTY for interactive terminal access.
   * Opens Claude without prompt, then sends the prompt via PTY stdin to avoid truncation.
   * Uses intelligent readiness detection instead of arbitrary waits.
   */
  private async spawnWithPty(
    spawnId: string,
    spawnedAt: string,
    request: WorkerSpawnRequest,
    logPath: string
  ): Promise<SpawnResult> {
    const ptyManager = getSharedPtyManager();
    const shortId = spawnId.slice(0, 8);

    try {
      console.log(`[PTY:${shortId}] Creating PTY session...`);

      // Spawn Claude via cmd.exe to resolve PATH (node-pty doesn't resolve PATH)
      // Start without prompt - we'll send it via PTY stdin after Claude is ready
      // --dangerously-skip-permissions for autonomous operation
      await ptyManager.createSession({
        sessionId: spawnId,
        command: 'cmd.exe',
        args: ['/c', 'claude', '--dangerously-skip-permissions'],
        cwd: request.workingDirectory,
        logPath,
        cols: 150,
        rows: 40,
      });

      // Track this as a PTY spawn
      this.ptySpawns.add(spawnId);
      console.log(`[PTY:${shortId}] Session created, waiting for Claude to be ready...`);

      // Wait for Claude Code to be ready by watching for the prompt character
      const ready = await this.waitForClaudeReady(ptyManager, spawnId, 15000);
      if (!ready) {
        console.error(`[PTY:${shortId}] Claude did not become ready within timeout`);
        // Kill PTY and fail - Ralph loop will retry
        ptyManager.kill(spawnId);
        this.ptySpawns.delete(spawnId);
        return {
          success: false,
          spawnId,
          spawnedAt,
          error: 'Claude Code did not become ready within timeout (15s)',
        };
      }
      console.log(`[PTY:${shortId}] Claude is ready, waiting 500ms for UI to settle...`);

      // Longer delay for UI to fully settle after detecting readiness
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send the prompt via PTY stdin (avoids command-line length limits)
      // This simulates the user typing the prompt after Claude opens
      console.log(`[PTY:${shortId}] Writing prompt (${request.promptContent.length} chars)...`);
      ptyManager.write(spawnId, request.promptContent);

      // Wait for Claude to receive and buffer the prompt text
      // PTY input doesn't always generate output, so quiescence isn't reliable
      // Use a fixed delay based on prompt length (longer prompts need more time)
      const promptDelay = Math.max(1000, Math.min(3000, request.promptContent.length * 2));
      console.log(`[PTY:${shortId}] Waiting ${promptDelay}ms for prompt to be buffered...`);
      await new Promise(resolve => setTimeout(resolve, promptDelay));

      // Press Enter to submit the prompt
      console.log(`[PTY:${shortId}] Sending Enter to submit prompt...`);
      ptyManager.write(spawnId, '\r');

      console.log(`[PTY:${shortId}] Spawn complete, prompt submitted`);
      return {
        success: true,
        spawnId,
        spawnedAt,
      };
    } catch (error) {
      console.error(`[PTY:${shortId}] Spawn error:`, error);
      return {
        success: false,
        spawnId,
        spawnedAt,
        error: `Failed to spawn PTY: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Waits for Claude Code to be ready by watching PTY output for the prompt character.
   * Returns true if ready, false if timeout.
   */
  private waitForClaudeReady(
    ptyManager: PtyManager,
    spawnId: string,
    timeoutMs: number
  ): Promise<boolean> {
    const shortId = spawnId.slice(0, 8);
    return new Promise((resolve) => {
      let outputBuffer = '';
      let resolved = false;

      const cleanup = ptyManager.onData((sessionId, data) => {
        if (sessionId !== spawnId || resolved) return;

        outputBuffer += data;
        // Claude Code shows '❯' prompt character when ready for input
        if (outputBuffer.includes('❯')) {
          resolved = true;
          cleanup();
          console.log(`[PTY:${shortId}] Detected ❯ prompt - Claude is ready`);
          resolve(true);
        }
      });

      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          console.warn(`[PTY:${shortId}] Readiness timeout (${timeoutMs}ms) - last output: ${outputBuffer.slice(-200)}`);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  /**
   * Waits for PTY output to become quiet (no significant output for quietMs).
   * Used to ensure prompt is fully rendered before pressing Enter.
   *
   * @param quietMs - How long of no significant output before considering it quiet
   * @param minBytes - Minimum bytes to consider as "significant" output (filters cursor blink)
   */
  private waitForOutputQuiescence(
    ptyManager: PtyManager,
    spawnId: string,
    quietMs: number,
    minBytes: number = 50
  ): Promise<void> {
    const shortId = spawnId.slice(0, 8);
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout;
      let resolved = false;
      let significantOutputCount = 0;

      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            console.log(`[PTY:${shortId}] Quiescence achieved after ${significantOutputCount} significant outputs`);
            resolve();
          }
        }, quietMs);
      };

      const cleanup = ptyManager.onData((sessionId, data) => {
        if (sessionId !== spawnId || resolved) return;
        // Only reset timer for significant output (not cursor blink)
        if (data.length >= minBytes) {
          significantOutputCount++;
          resetTimer();
        }
      });

      // Start the quiescence timer
      resetTimer();

      // Max wait of 3 seconds (reduced from 5s)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          clearTimeout(timer);
          console.log(`[PTY:${shortId}] Quiescence timeout (3s), proceeding anyway`);
          resolve();
        }
      }, 3000);
    });
  }

  /**
   * Writes spawn info to the worktree for tracking.
   */
  private async writeSpawnInfo(workingDirectory: string, info: SpawnInfo): Promise<void> {
    const claudeDir = path.join(workingDirectory, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const infoPath = path.join(claudeDir, 'spawn-info.json');
    await fs.promises.writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8');
  }
}

/**
 * Creates the appropriate spawner for the current platform.
 */
export function createSpawner(): WorkerSpawner {
  if (process.platform === 'win32') {
    return new WindowsTerminalSpawner();
  }

  // TODO: Add support for other platforms (macOS with iTerm, Linux with tmux)
  throw new Error(`No worker spawner available for platform: ${process.platform}`);
}
