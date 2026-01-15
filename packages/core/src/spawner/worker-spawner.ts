import { WorkerSpawnRequest } from '../session/types.js';

/**
 * Worker runtime status.
 */
export interface WorkerStatus {
  /** Whether the worker process is currently running. */
  running: boolean;
  /** Exit code if the worker has exited. */
  exitCode?: number;
}

/**
 * Result of spawning a worker.
 */
export interface SpawnResult {
  /** Whether the spawn was successful. */
  success: boolean;

  /**
   * Unique spawn ID for this worker instance.
   * Used to track worker lifecycle, especially for Ralph loop.
   * This is written to .claude/spawn-info.json in the worktree.
   */
  spawnId: string;

  /**
   * Timestamp when the worker was spawned.
   */
  spawnedAt: string;

  /**
   * Error message if spawn failed.
   */
  error?: string;
}

/**
 * Information about a spawn written to the worktree.
 * Located at .claude/spawn-info.json
 */
export interface SpawnInfo {
  /** Unique ID for this spawn instance. */
  spawnId: string;
  /** When the worker was spawned. */
  spawnedAt: string;
  /** Issue numbers this worker is handling. */
  issueNumbers: number[];
  /** Ralph iteration number (1-indexed, only for ralph mode). */
  iteration?: number;
}

/**
 * Interface for worker spawning implementations.
 * Different platforms/terminals implement this differently.
 */
export interface WorkerSpawner {
  /**
   * Checks if this spawner is available on the current system.
   */
  isAvailable(): boolean;

  /**
   * Spawns a new worker session.
   * @returns SpawnResult with spawn metadata
   */
  spawn(request: WorkerSpawnRequest): Promise<SpawnResult>;

  /**
   * Gets the name of this spawner (for logging/display).
   */
  getName(): string;

  /**
   * Stops a running worker.
   * @param spawnId - The spawn ID returned from spawn()
   */
  stop(spawnId: string): Promise<void>;

  /**
   * Gets the current status of a worker.
   * @param spawnId - The spawn ID returned from spawn()
   * @returns WorkerStatus with running state and exit code
   */
  getStatus(spawnId: string): Promise<WorkerStatus>;
}
