import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WorkerSpawner, SpawnResult, SpawnInfo, WorkerStatus } from './worker-spawner.js';
import { WorkerSpawnRequest } from '../session/types.js';

/**
 * Escapes a string for safe use in PowerShell commands.
 * Handles backticks, dollar signs, and double quotes.
 */
function escapePowerShellString(str: string): string {
  return str
    .replace(/`/g, '``')      // Escape backticks first
    .replace(/\$/g, '`$')     // Escape dollar signs
    .replace(/"/g, '`"')      // Escape double quotes
    .replace(/\\/g, '\\\\');  // Escape backslashes for -like pattern
}

/**
 * Windows Terminal worker spawner.
 * Spawns Claude Code workers in new Windows Terminal tabs.
 */
export class WindowsTerminalSpawner implements WorkerSpawner {
  private wtPath: string | null = null;
  /**
   * Track spawned workers by spawn ID -> worktree path.
   * This allows stop() and getStatus() to find the right worker.
   */
  private spawnedWorkers = new Map<string, string>();

  getName(): string {
    return 'Windows Terminal';
  }

  /**
   * Checks if Windows Terminal is available.
   * Uses fs.existsSync and 'where' command to avoid opening windows.
   */
  isAvailable(): boolean {
    if (this.wtPath !== null) {
      return true;
    }

    // Check if wt.exe exists in WindowsApps
    const windowsAppsPath = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WindowsApps',
      'wt.exe'
    );

    if (fs.existsSync(windowsAppsPath)) {
      this.wtPath = windowsAppsPath;
      return true;
    }

    // Check if wt.exe is in PATH using 'where' command (doesn't open windows)
    try {
      const result = spawnSync('where', ['wt.exe'], {
        stdio: 'pipe',
        windowsHide: true,
      });
      if (result.status === 0) {
        this.wtPath = 'wt.exe';
        return true;
      }
    } catch {
      // Ignore errors
    }

    return false;
  }

  /**
   * Spawns a Claude Code worker in a new Windows Terminal tab.
   */
  async spawn(request: WorkerSpawnRequest): Promise<SpawnResult> {
    const spawnId = crypto.randomUUID();
    const spawnedAt = new Date().toISOString();

    if (!this.isAvailable()) {
      return {
        success: false,
        spawnId,
        spawnedAt,
        error: 'Windows Terminal is not available',
      };
    }

    // Write spawn info to worktree for tracking
    const spawnInfo: SpawnInfo = {
      spawnId,
      spawnedAt,
      issueNumbers: [request.issue.number],
    };
    await this.writeSpawnInfo(request.workingDirectory, spawnInfo);

    // Tab title shows the issue
    const tabTitle = `Issue #${request.issue.number}`;

    // Build the Claude command
    const claudeCommand = this.buildClaudeCommand(request);

    // Write wrapper scripts (.cmd and .ps1) and get path to the batch wrapper
    const wrapperScriptPath = await this.writeWrapperScripts(request.workingDirectory, claudeCommand);
    // Run the batch file directly - no PowerShell wrapper needed
    const wrapperCommand = `"${wrapperScriptPath}"`;

    // Windows Terminal command to open a new tab
    // Use cmd /c with wrapper - wrapper decides whether to close or stay open
    const args = [
      'new-tab',
      '--title', tabTitle,
      '--startingDirectory', request.workingDirectory,
      'cmd', '/c', wrapperCommand,
    ];

    return new Promise((resolve) => {
      const proc = spawn(this.wtPath || 'wt.exe', args, {
        detached: true,
        stdio: 'ignore',
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          spawnId,
          spawnedAt,
          error: `Failed to spawn Windows Terminal: ${error.message}`,
        });
      });

      // Don't wait for the process - it's detached
      proc.unref();

      // Give it a moment to start
      setTimeout(() => {
        // Track this spawn for stop() and getStatus()
        this.spawnedWorkers.set(spawnId, request.workingDirectory);
        resolve({
          success: true,
          spawnId,
          spawnedAt,
        });
      }, 500);
    });
  }

  /**
   * Stops a running worker by creating an exit signal file.
   * The session watcher script will detect this and terminate the Claude process.
   */
  async stop(spawnId: string): Promise<void> {
    const worktreePath = this.spawnedWorkers.get(spawnId);
    if (!worktreePath) {
      throw new Error(`Unknown spawn ID: ${spawnId}`);
    }

    // Create exit signal file that the watcher script monitors
    const signalPath = path.join(worktreePath, '.claude', 'exit-signal');
    await fs.promises.writeFile(signalPath, 'stop', 'utf-8');

    // Also try to kill any claude processes for this worktree
    // The watcher script should handle this, but we do it here as backup
    try {
      spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'claude.exe' -and $_.CommandLine -like '*${escapePowerShellString(worktreePath)}*' } | ForEach-Object { taskkill /T /F /PID $_.ProcessId }`,
      ], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // Ignore errors - the watcher should handle cleanup
    }
  }

  /**
   * Gets the current status of a worker by checking the spawn info and session files.
   */
  async getStatus(spawnId: string): Promise<WorkerStatus> {
    const worktreePath = this.spawnedWorkers.get(spawnId);
    if (!worktreePath) {
      // Unknown spawn - assume not running
      return { running: false };
    }

    // Check if exit signal file exists (worker was told to stop)
    const signalPath = path.join(worktreePath, '.claude', 'exit-signal');
    if (fs.existsSync(signalPath)) {
      return { running: false, exitCode: 0 };
    }

    // Check session file for terminal statuses
    try {
      const contextPath = path.join(worktreePath, '.claude', 'session-context.json');
      if (fs.existsSync(contextPath)) {
        const contextContent = await fs.promises.readFile(contextPath, 'utf-8');
        const context = JSON.parse(contextContent);
        if (context.sessionFilePath && fs.existsSync(context.sessionFilePath)) {
          const sessionContent = await fs.promises.readFile(context.sessionFilePath, 'utf-8');
          const session = JSON.parse(sessionContent);
          const terminalStatuses = ['complete', 'cancelled', 'stuck'];
          if (terminalStatuses.includes(session.status)) {
            return { running: false, exitCode: session.status === 'complete' ? 0 : 1 };
          }
        }
      }
    } catch {
      // Ignore errors reading session
    }

    // Check if Claude process is running for this worktree
    try {
      const result = spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'claude.exe' -and $_.CommandLine -like '*${worktreePath.replace(/\\/g, '\\\\')}*' }).Count`,
      ], {
        stdio: 'pipe',
        windowsHide: true,
      });
      const count = parseInt(result.stdout?.toString().trim() || '0', 10);
      return { running: count > 0 };
    } catch {
      // Can't determine - assume not running
      return { running: false };
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

  /**
   * Writes wrapper scripts that manage Claude's lifecycle.
   *
   * Uses a two-script architecture:
   * 1. worker-wrapper.cmd - Batch file that runs Claude directly and controls exit code
   * 2. session-watcher.ps1 - Hidden PowerShell script that monitors session status
   *
   * This approach solves the exit code problem: when taskkill terminates processes,
   * the batch file still runs and can exit with code 0 for clean terminal closure.
   */
  private async writeWrapperScripts(worktreePath: string, claudeCommand: string): Promise<string> {
    const claudeDir = path.join(worktreePath, '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Write the session watcher PowerShell script
    const watcherPath = path.join(claudeDir, 'session-watcher.ps1');
    const watcherScript = `# Session Watcher Script - Auto-generated by orchestrator
# Monitors session status and signals wrapper when to exit cleanly

param([string]$sessionPath)

$ErrorActionPreference = 'SilentlyContinue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Get parent PID (the worker-wrapper.cmd process) to scope process killing
# This ensures we only kill processes belonging to THIS worker, not all workers
$parentPid = 0
try {
    $myProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction Stop
    $parentPid = $myProcess.ParentProcessId
} catch {
    # If we can't get the parent PID, we'll fall back to signal-only mode
}

while ($true) {
    Start-Sleep -Seconds 1

    try {
        $session = Get-Content $sessionPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $status = $session.status

        if ($status -eq 'complete' -or $status -eq 'cancelled') {
            # Create signal file for wrapper to detect (do this FIRST)
            "clean" | Out-File (Join-Path $scriptDir 'exit-signal') -Force -Encoding ASCII

            if ($parentPid -ne 0) {
                # Kill Claude process tree associated with this specific worker only
                # We find children of our parent (worker-wrapper.cmd) that look like the Claude process
                Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                    $_.ParentProcessId -eq $parentPid -and (
                        ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*claude*--dangerously-skip-permissions*') -or
                        ($_.Name -eq 'claude.exe')
                    )
                } | ForEach-Object {
                    & taskkill /T /F /PID $_.ProcessId 2>$null
                }
            }

            exit 0
        }
    } catch {
        # Ignore errors, keep polling
    }
}
`;
    await fs.promises.writeFile(watcherPath, watcherScript, 'utf-8');

    // Write the batch wrapper script
    const wrapperPath = path.join(claudeDir, 'worker-wrapper.cmd');

    // Escape the claude command for batch - double up percent signs
    const batchClaudeCommand = claudeCommand.replace(/%/g, '%%');

    const wrapperScript = `@echo off
REM Worker Wrapper Script - Auto-generated by orchestrator
REM Manages Claude lifecycle and controls exit code for clean terminal closure

setlocal EnableDelayedExpansion

REM Read session path from context
for /f "usebackq tokens=*" %%a in (\`powershell -NoProfile -Command "(Get-Content 'session-context.json' | ConvertFrom-Json).sessionFilePath"\`) do set "SESSION_PATH=%%a"

if "%SESSION_PATH%"=="" (
    echo ERROR: No sessionFilePath in session-context.json
    pause
    exit /b 1
)

echo ==================================================
echo PROMPT SENT TO CLAUDE:
echo ==================================================
type ".claude\\session-prompt.md"
echo.
echo ==================================================
echo.
echo Worker started. Monitoring session: %SESSION_PATH%
echo.

REM Start background watcher (hidden PowerShell window)
start "" /b powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File ".claude\\session-watcher.ps1" "%SESSION_PATH%"

REM Run Claude directly (blocking, output visible, interactive)
REM Note: No cmd /c wrapper - pipe needs to run in batch context
${batchClaudeCommand}

REM Claude exited - check for clean exit signal from watcher
if exist ".claude\\exit-signal" (
    del ".claude\\exit-signal" >nul 2>&1
    exit /b 0
)

REM No signal file - check session status directly (handles natural Claude exit)
REM This covers the race condition where Claude exits before watcher detects completion
for /f "usebackq tokens=*" %%s in (\`powershell -NoProfile -Command "(Get-Content '%SESSION_PATH%' -ErrorAction SilentlyContinue | ConvertFrom-Json).status"\`) do (
    if "%%s"=="complete" exit /b 0
    if "%%s"=="cancelled" exit /b 0
)

REM Not clean exit - show status and wait for user input
echo.
echo ==================================================

REM Get current status
for /f "usebackq tokens=*" %%s in (\`powershell -NoProfile -Command "(Get-Content '%SESSION_PATH%' | ConvertFrom-Json).status"\`) do set "STATUS=%%s"
echo   Worker stopped. Status: %STATUS%

REM Get stuck reason if any
for /f "usebackq tokens=*" %%r in (\`powershell -NoProfile -Command "$s=(Get-Content '%SESSION_PATH%' | ConvertFrom-Json).stuckReason; if($s){$s}"\`) do (
    if not "%%r"=="" echo   Reason: %%r
)

echo   Review the output above, then press any key...
echo ==================================================
pause >nul
`;
    await fs.promises.writeFile(wrapperPath, wrapperScript, 'utf-8');

    return wrapperPath;
  }

  /**
   * Builds the Claude command to run in the terminal.
   * Passes prompt directly as bootstrap message - interactive mode with visible output.
   */
  private buildClaudeCommand(request: WorkerSpawnRequest): string {
    // Collapse newlines to spaces (cmd.exe can't handle multi-line strings)
    // Escape quotes for Windows cmd by doubling them
    const escaped = request.promptContent
      .replace(/\r?\n/g, ' ')
      .replace(/"/g, '""');

    return `claude --dangerously-skip-permissions "${escaped}"`;
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
