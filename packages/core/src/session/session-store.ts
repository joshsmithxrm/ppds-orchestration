import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionState, SessionContext, SessionDynamicState } from './types.js';

/**
 * File-based session store.
 * Handles reading/writing session JSON files to disk.
 *
 * Session files are stored in: ~/.orchestration/{project}/sessions/work-{id}.json
 * Worktree files are stored in: {worktreePath}/session-context.json and session-state.json
 */
export class SessionStore {
  private readonly sessionsDir: string;
  private readonly projectName: string;

  constructor(projectName: string, baseDir?: string) {
    this.projectName = projectName;
    const orchestrationDir = baseDir ?? path.join(os.homedir(), '.orchestration');
    this.sessionsDir = path.join(orchestrationDir, projectName, 'sessions');
  }

  /**
   * Gets the sessions directory path.
   */
  getSessionsDir(): string {
    return this.sessionsDir;
  }

  /**
   * Ensures the sessions directory exists.
   */
  private ensureSessionsDir(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Gets the file path for a session.
   */
  getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsDir, `work-${sessionId}.json`);
  }

  /**
   * Saves a session to disk.
   */
  async save(session: SessionState): Promise<void> {
    this.ensureSessionsDir();
    const filePath = this.getSessionFilePath(session.id);
    const json = JSON.stringify(session, null, 2);
    await fs.promises.writeFile(filePath, json, 'utf-8');
  }

  /**
   * Loads a session from disk.
   */
  async load(sessionId: string): Promise<SessionState | null> {
    const filePath = this.getSessionFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const json = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(json);
      return SessionState.parse(parsed);
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Lists all sessions from disk.
   * Only returns active sessions (excludes complete and cancelled).
   */
  async listActive(): Promise<SessionState[]> {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    const files = await fs.promises.readdir(this.sessionsDir);
    const sessionFiles = files.filter(f => f.startsWith('work-') && f.endsWith('.json'));

    const sessions: SessionState[] = [];

    for (const file of sessionFiles) {
      try {
        const filePath = path.join(this.sessionsDir, file);
        const json = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(json);
        const session = SessionState.parse(parsed);

        // Only include active sessions
        if (session.status !== 'complete' && session.status !== 'cancelled') {
          sessions.push(session);
        }
      } catch (error) {
        console.error(`Failed to load session from ${file}:`, error);
      }
    }

    // Sort by primary issue number
    return sessions.sort((a, b) => a.issues[0].number - b.issues[0].number);
  }

  /**
   * Lists all sessions from disk (including complete and cancelled).
   */
  async listAll(): Promise<SessionState[]> {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    const files = await fs.promises.readdir(this.sessionsDir);
    const sessionFiles = files.filter(f => f.startsWith('work-') && f.endsWith('.json'));

    const sessions: SessionState[] = [];

    for (const file of sessionFiles) {
      try {
        const filePath = path.join(this.sessionsDir, file);
        const json = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(json);
        const session = SessionState.parse(parsed);
        sessions.push(session);
      } catch (error) {
        console.error(`Failed to load session from ${file}:`, error);
      }
    }

    // Sort by primary issue number
    return sessions.sort((a, b) => a.issues[0].number - b.issues[0].number);
  }

  /**
   * Deletes a session file.
   */
  async delete(sessionId: string): Promise<void> {
    const filePath = this.getSessionFilePath(sessionId);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  /**
   * Checks if a session exists.
   */
  exists(sessionId: string): boolean {
    return fs.existsSync(this.getSessionFilePath(sessionId));
  }

  // ============================================
  // Worktree context file methods
  // ============================================

  /**
   * Writes the static session context to the worktree.
   * This is written once at spawn time and never changes.
   */
  async writeSessionContext(worktreePath: string, context: SessionContext): Promise<void> {
    const filePath = path.join(worktreePath, 'session-context.json');
    const json = JSON.stringify(context, null, 2);
    await fs.promises.writeFile(filePath, json, 'utf-8');
  }

  /**
   * Reads the session context from a worktree.
   */
  async readSessionContext(worktreePath: string): Promise<SessionContext | null> {
    const filePath = path.join(worktreePath, 'session-context.json');

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const json = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(json);
      return SessionContext.parse(parsed);
    } catch (error) {
      console.error(`Failed to read session context from ${worktreePath}:`, error);
      return null;
    }
  }

  /**
   * Writes the dynamic session state to the worktree.
   * This is updated when the orchestrator forwards messages.
   */
  async writeSessionState(worktreePath: string, state: SessionDynamicState): Promise<void> {
    const filePath = path.join(worktreePath, 'session-state.json');
    const json = JSON.stringify(state, null, 2);
    await fs.promises.writeFile(filePath, json, 'utf-8');
  }

  /**
   * Reads the dynamic session state from a worktree.
   */
  async readSessionState(worktreePath: string): Promise<SessionDynamicState | null> {
    const filePath = path.join(worktreePath, 'session-state.json');

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const json = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(json);
      return SessionDynamicState.parse(parsed);
    } catch (error) {
      console.error(`Failed to read session state from ${worktreePath}:`, error);
      return null;
    }
  }
}
