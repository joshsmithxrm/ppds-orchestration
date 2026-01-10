import * as fs from 'node:fs';
import * as path from 'node:path';
import { watch, FSWatcher } from 'chokidar';
import { SessionState } from '../session/types.js';

export type SessionWatcherEvent = 'add' | 'update' | 'remove';

export interface SessionWatcherCallback {
  (event: SessionWatcherEvent, session: SessionState | null, sessionId: string): void;
}

/**
 * Watches session files for real-time updates.
 * Uses chokidar for cross-platform file watching.
 */
export class SessionWatcher {
  private watcher: FSWatcher | null = null;
  private callbacks: SessionWatcherCallback[] = [];
  private readonly sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  /**
   * Starts watching for session file changes.
   */
  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    // Ensure directory exists
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }

    const pattern = path.join(this.sessionsDir, 'work-*.json');

    this.watcher = watch(pattern, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath) => {
      this.handleFileChange('add', filePath);
    });

    this.watcher.on('change', (filePath) => {
      this.handleFileChange('update', filePath);
    });

    this.watcher.on('unlink', (filePath) => {
      const sessionId = this.extractSessionId(filePath);
      if (sessionId) {
        this.emit('remove', null, sessionId);
      }
    });

    this.watcher.on('error', (error) => {
      console.error('Session watcher error:', error);
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
   * Registers a callback for session events.
   */
  on(callback: SessionWatcherCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Removes a callback.
   */
  off(callback: SessionWatcherCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index !== -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Handles a file change event.
   */
  private handleFileChange(event: 'add' | 'update', filePath: string): void {
    const sessionId = this.extractSessionId(filePath);
    if (!sessionId) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const session = SessionState.parse(JSON.parse(content));
      this.emit(event, session, sessionId);
    } catch (error) {
      console.error(`Failed to parse session file ${filePath}:`, error);
    }
  }

  /**
   * Extracts session ID from file path.
   */
  private extractSessionId(filePath: string): string | null {
    const filename = path.basename(filePath);
    const match = filename.match(/^work-(.+)\.json$/);
    return match ? match[1] : null;
  }

  /**
   * Emits an event to all callbacks.
   */
  private emit(event: SessionWatcherEvent, session: SessionState | null, sessionId: string): void {
    for (const callback of this.callbacks) {
      try {
        callback(event, session, sessionId);
      } catch (error) {
        console.error('Session watcher callback error:', error);
      }
    }
  }
}
