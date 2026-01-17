import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WorkerSpawner, SpawnResult, SpawnInfo, WorkerStatus } from './worker-spawner.js';
import { WorkerSpawnRequest } from '../session/types.js';
import { getSharedPtyManager } from '../pty/pty-manager.js';

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
   */
  private async spawnWithPty(
    spawnId: string,
    spawnedAt: string,
    request: WorkerSpawnRequest,
    logPath: string
  ): Promise<SpawnResult> {
    const ptyManager = getSharedPtyManager();

    try {
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

      // Wait for Claude to initialize before sending prompt
      // Claude needs time to start and show its prompt
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send the prompt via PTY stdin (avoids command-line length limits)
      // This simulates the user typing the prompt after Claude opens
      ptyManager.write(spawnId, request.promptContent);

      // Small delay to ensure prompt is fully written before pressing Enter
      await new Promise(resolve => setTimeout(resolve, 100));

      // Press Enter to submit the prompt (use \r\n for Windows compatibility)
      ptyManager.write(spawnId, '\r\n');

      return {
        success: true,
        spawnId,
        spawnedAt,
      };
    } catch (error) {
      return {
        success: false,
        spawnId,
        spawnedAt,
        error: `Failed to spawn PTY: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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
