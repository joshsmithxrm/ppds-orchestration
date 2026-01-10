import { WorkerSpawnRequest } from '../session/types.js';

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
   */
  spawn(request: WorkerSpawnRequest): Promise<void>;

  /**
   * Gets the name of this spawner (for logging/display).
   */
  getName(): string;
}
