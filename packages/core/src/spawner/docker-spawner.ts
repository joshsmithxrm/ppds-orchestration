import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WorkerSpawner, SpawnResult, SpawnInfo, WorkerStatus } from './worker-spawner.js';
import { WorkerSpawnRequest } from '../session/types.js';

/**
 * Docker spawner configuration.
 */
export interface DockerSpawnerConfig {
  /** Docker image to use */
  image: string;
  /** Memory limit (e.g., '4g') */
  memoryLimit: string;
  /** CPU limit (e.g., '2') */
  cpuLimit: string;
  /** Additional volume mounts (host:container format) */
  volumes: string[];
  /** Additional environment variables */
  env: Record<string, string>;
}

/**
 * Default configuration for Docker spawner.
 */
const DEFAULT_CONFIG: DockerSpawnerConfig = {
  image: 'ppds-worker:latest',
  memoryLimit: '4g',
  cpuLimit: '2',
  volumes: [],
  env: {},
};

/**
 * Spawner that runs workers in Docker containers.
 *
 * Features:
 * - Security hardening (CapDrop ALL, PidsLimit, no-new-privileges)
 * - Pre-restore logic for dotnet and npm dependencies
 * - Volume mounts for worktree and credentials
 */
export class DockerSpawner implements WorkerSpawner {
  private config: DockerSpawnerConfig;
  private runningContainers = new Map<string, string>(); // spawnId -> containerId

  constructor(config?: Partial<DockerSpawnerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Checks if Docker is available on the system.
   */
  isAvailable(): boolean {
    try {
      const result = spawnSync('docker', ['--version'], {
        stdio: 'pipe',
        windowsHide: true,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Gets the spawner name.
   */
  getName(): string {
    return 'Docker Spawner';
  }

  /**
   * Spawns a worker in a Docker container.
   */
  async spawn(request: WorkerSpawnRequest): Promise<SpawnResult> {
    const spawnId = crypto.randomUUID();
    const spawnedAt = new Date().toISOString();

    if (!this.isAvailable()) {
      return {
        success: false,
        spawnId,
        spawnedAt,
        error: 'Docker is not available',
      };
    }

    // Write spawn info to worktree
    const spawnInfo: SpawnInfo = {
      spawnId,
      spawnedAt,
      issueNumbers: [request.issue.number],
    };
    await this.writeSpawnInfo(request.workingDirectory, spawnInfo);

    // Build container name
    const containerName = `ppds-worker-${request.sessionId}-${spawnId.slice(0, 8)}`;

    // Build Docker run command with security hardening
    const args = this.buildDockerArgs(containerName, request);

    return new Promise((resolve) => {
      const proc = spawn('docker', args, {
        stdio: 'pipe',
        detached: true,
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          spawnId,
          spawnedAt,
          error: `Failed to start Docker: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({
            success: false,
            spawnId,
            spawnedAt,
            error: `Docker exited with code ${code}: ${stderr}`,
          });
          return;
        }

        // Get container ID
        const getIdResult = spawnSync('docker', ['ps', '-qf', `name=${containerName}`], {
          stdio: 'pipe',
        });
        const containerId = getIdResult.stdout?.toString().trim();
        if (containerId) {
          this.runningContainers.set(spawnId, containerId);
        }

        resolve({
          success: true,
          spawnId,
          spawnedAt,
        });
      });

      proc.unref();
    });
  }

  /**
   * Stops a running worker container.
   */
  async stop(spawnId: string): Promise<void> {
    const containerId = this.runningContainers.get(spawnId);
    if (!containerId) {
      return;
    }

    await new Promise<void>((resolve) => {
      const proc = spawn('docker', ['stop', '-t', '10', containerId], {
        stdio: 'ignore',
      });
      proc.on('close', () => {
        this.runningContainers.delete(spawnId);
        resolve();
      });
      proc.on('error', () => {
        resolve();
      });
    });
  }

  /**
   * Gets the status of a worker container.
   */
  async getStatus(spawnId: string): Promise<WorkerStatus> {
    const containerId = this.runningContainers.get(spawnId);
    if (!containerId) {
      return { running: false };
    }

    try {
      const result = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', containerId], {
        stdio: 'pipe',
      });
      const running = result.stdout?.toString().trim() === 'true';

      if (!running) {
        // Get exit code
        const exitResult = spawnSync('docker', ['inspect', '-f', '{{.State.ExitCode}}', containerId], {
          stdio: 'pipe',
        });
        const exitCode = parseInt(exitResult.stdout?.toString().trim() || '0', 10);
        return { running: false, exitCode };
      }

      return { running: true };
    } catch {
      return { running: false };
    }
  }

  /**
   * Builds Docker run arguments with security hardening.
   */
  private buildDockerArgs(containerName: string, request: WorkerSpawnRequest): string[] {
    const args = [
      'run',
      '--rm',
      '--name', containerName,
      // Security hardening
      '--cap-drop', 'ALL',
      '--pids-limit', '100',
      '--security-opt', 'no-new-privileges',
      // Resource limits
      '--memory', this.config.memoryLimit,
      '--cpus', this.config.cpuLimit,
      // Mount worktree
      '-v', `${request.workingDirectory}:/workspace`,
      // Mount prompt file
      '-v', `${request.promptFilePath}:/workspace/.claude/session-prompt.md:ro`,
      // Working directory
      '-w', '/workspace',
    ];

    // Add user volume mounts
    for (const volume of this.config.volumes) {
      args.push('-v', volume);
    }

    // Add environment variables
    args.push('-e', `GITHUB_OWNER=${request.githubOwner}`);
    args.push('-e', `GITHUB_REPO=${request.githubRepo}`);
    args.push('-e', `SESSION_ID=${request.sessionId}`);
    args.push('-e', `ISSUE_NUMBER=${request.issue.number}`);

    for (const [key, value] of Object.entries(this.config.env)) {
      args.push('-e', `${key}=${value}`);
    }

    // Image and command
    args.push(this.config.image);
    args.push('claude');
    args.push('--dangerously-skip-permissions');
    args.push(`You are an autonomous worker for Issue #${request.issue.number}. Read .claude/session-prompt.md for your full instructions and begin.`);

    return args;
  }

  /**
   * Writes spawn info to the worktree.
   */
  private async writeSpawnInfo(worktreePath: string, info: SpawnInfo): Promise<void> {
    const claudeDir = path.join(worktreePath, '.claude');
    if (!fs.existsSync(claudeDir)) {
      await fs.promises.mkdir(claudeDir, { recursive: true });
    }
    const infoPath = path.join(claudeDir, 'spawn-info.json');
    await fs.promises.writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8');
  }
}
