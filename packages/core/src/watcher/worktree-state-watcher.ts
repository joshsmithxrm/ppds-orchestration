import * as fs from 'node:fs';
import * as path from 'node:path';
import { watch, FSWatcher } from 'chokidar';
import { SessionDynamicState } from '../session/types.js';

export type WorktreeStateEvent = 'update';

export interface WorktreeStateCallback {
  (event: WorktreeStateEvent, sessionId: string, state: SessionDynamicState): void;
}

interface WatchedSession {
  sessionId: string;
  worktreePath: string;
}

/**
 * Watches session-state.json files in worktrees for real-time status updates.
 * When a worker updates its status, this watcher detects it and emits an event.
 */
export class WorktreeStateWatcher {
  private watcher: FSWatcher | null = null;
  private callbacks: WorktreeStateCallback[] = [];
  private sessions: Map<string, WatchedSession> = new Map();

  /**
   * Adds a session to watch.
   */
  addSession(sessionId: string, worktreePath: string): void {
    const stateFilePath = path.join(worktreePath, 'session-state.json');
    this.sessions.set(stateFilePath, { sessionId, worktreePath });

    if (this.watcher) {
      this.watcher.add(stateFilePath);
    }
  }

  /**
   * Removes a session from watching.
   */
  removeSession(sessionId: string, worktreePath: string): void {
    const stateFilePath = path.join(worktreePath, 'session-state.json');
    this.sessions.delete(stateFilePath);

    if (this.watcher) {
      this.watcher.unwatch(stateFilePath);
    }
  }

  /**
   * Starts watching for worktree state changes.
   */
  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    // Get all state file paths
    const paths = Array.from(this.sessions.keys());

    this.watcher = watch(paths, {
      persistent: true,
      ignoreInitial: true, // Don't emit for existing files
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('change', (filePath) => {
      this.handleFileChange(filePath);
    });

    this.watcher.on('error', (error) => {
      console.error('Worktree state watcher error:', error);
    });
  }

  /**
   * Stops watching for changes.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Registers a callback for state events.
   */
  on(callback: WorktreeStateCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Removes a callback.
   */
  off(callback: WorktreeStateCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Handles a file change event.
   */
  private handleFileChange(filePath: string): void {
    const session = this.sessions.get(filePath);
    if (!session) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const state = SessionDynamicState.parse(JSON.parse(content));
      this.emit('update', session.sessionId, state);
    } catch (error) {
      console.error(`Failed to parse worktree state file ${filePath}:`, error);
    }
  }

  /**
   * Emits an event to all callbacks.
   */
  private emit(event: WorktreeStateEvent, sessionId: string, state: SessionDynamicState): void {
    for (const callback of this.callbacks) {
      try {
        callback(event, sessionId, state);
      } catch (error) {
        console.error('Worktree state watcher callback error:', error);
      }
    }
  }
}
