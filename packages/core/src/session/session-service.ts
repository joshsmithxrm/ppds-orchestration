import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import {
  SessionState,
  SessionStatus,
  SessionContext,
  SessionListResult,
  WorktreeStatus,
  WorktreeState,
  ExecutionMode,
  DeletionMode,
  IssueRef,
  STALE_THRESHOLD_MS,
  DeleteResult,
  WorktreeRemovalResult,
} from './types.js';
import { SessionStore } from './session-store.js';
import { GitUtils } from '../git/git-utils.js';
import { WorkerSpawner } from '../spawner/worker-spawner.js';
import { createSpawner } from '../spawner/windows-terminal-spawner.js';
import { WorkerPromptBuilder } from './worker-prompt-builder.js';

export interface SessionServiceConfig {
  /** Name of the project (used for session storage path). */
  projectName: string;

  /** Path to the git repository root. */
  repoRoot: string;

  /** GitHub owner (e.g., 'joshsmithxrm'). */
  githubOwner: string;

  /** GitHub repo name (e.g., 'power-platform-developer-suite'). */
  githubRepo: string;

  /** Optional: custom base directory for orchestration files. */
  baseDir?: string;

  /** Optional: custom worker spawner. */
  spawner?: WorkerSpawner;

  /** Optional: prefix for worktree directories. */
  worktreePrefix?: string;

  /** Optional: CLI command for workers to use (default: 'orch'). */
  cliCommand?: string;

  /** Optional: Base branch for worktrees (default: 'origin/main'). */
  baseBranch?: string;

  /** Optional: Use PTY for interactive terminal access via web dashboard. */
  usePty?: boolean;
}

/**
 * Options for spawning a new worker session.
 */
export interface SpawnOptions {
  /** Execution mode: 'manual' (user-controlled) or 'autonomous' (full loop). Default: 'manual'. */
  mode?: ExecutionMode;
  /** Additional prompt sections to inject (from hooks). */
  additionalPromptSections?: string[];
}

/**
 * Service for managing parallel worker sessions.
 * Port of PPDS SessionService.cs to TypeScript.
 */
export class SessionService {
  private readonly store: SessionStore;
  private readonly gitUtils: GitUtils;
  private readonly spawner: WorkerSpawner;
  private readonly promptBuilder: WorkerPromptBuilder;
  private readonly config: SessionServiceConfig;

  constructor(config: SessionServiceConfig) {
    this.config = config;
    this.store = new SessionStore(config.projectName, config.baseDir);
    this.gitUtils = new GitUtils(config.repoRoot);
    this.spawner = config.spawner ?? createSpawner();
    this.promptBuilder = new WorkerPromptBuilder();
  }

  /**
   * Spawns a new worker session for an issue.
   * @param issueNumber - The issue number to work on
   * @param options - Spawn options
   */
  async spawn(issueNumber: number, options?: SpawnOptions): Promise<SessionState> {
    const sessionId = issueNumber.toString();
    const mode = options?.mode ?? 'manual';

    // Check for existing active session with this issue
    const allSessions = await this.store.listAll();
    for (const existing of allSessions) {
      if (existing.status === 'complete' || existing.status === 'cancelled') continue;
      if (existing.issue.number === issueNumber) {
        throw new Error(`Issue #${issueNumber} already in active session '${existing.id}'`);
      }
    }

    // Clean up any completed/cancelled session with matching ID
    if (this.store.exists(sessionId)) {
      const existing = await this.store.load(sessionId);
      if (existing && (existing.status === 'complete' || existing.status === 'cancelled')) {
        // Session is complete/cancelled - allow re-spawn by deleting old session
        await this.store.delete(sessionId);
      }
    }

    // Check spawner availability
    if (!this.spawner.isAvailable()) {
      throw new Error(`Worker spawner (${this.spawner.getName()}) is not available`);
    }

    // Fetch issue from GitHub
    const issueData = await this.fetchIssue(issueNumber);
    const issueInfo: IssueRef = { number: issueNumber, title: issueData.title, body: issueData.body };

    // Generate branch and worktree names
    const worktreePrefix = this.config.worktreePrefix ?? `${path.basename(this.config.repoRoot)}-`;
    const branchName = `issue-${issueNumber}`;
    const worktreeName = `${worktreePrefix}${branchName}`;

    const worktreePath = path.join(path.dirname(this.config.repoRoot), worktreeName);

    // Check for orphaned worktree before creating
    if (fs.existsSync(worktreePath) && GitUtils.isWorktree(worktreePath)) {
      // Worktree exists but we don't have a session for it - it's an orphan
      const context = await this.store.readSessionContext(worktreePath);
      const orphanInfo = context?.sessionId ?? 'unknown';
      throw new Error(
        `ORPHAN_DETECTED:${worktreePath}:${orphanInfo}:Orphaned worktree exists at ${worktreePath}. ` +
        `Use cleanupOrphan() to remove it first, or spawn a different issue.`
      );
    }

    await this.gitUtils.createWorktree(
      worktreePath,
      branchName,
      this.config.baseBranch ?? 'origin/main'
    );

    // Write issue body to IMPLEMENTATION_PLAN.md in worktree
    // Worker reads full PRD/plan from this file, not from the prompt
    const planPath = path.join(worktreePath, 'IMPLEMENTATION_PLAN.md');
    await fs.promises.writeFile(planPath, issueData.body || '', 'utf-8');

    // Write worker prompt
    const promptPath = await this.writeWorkerPrompt(
      worktreePath,
      issueInfo,
      branchName,
      mode,
      options?.additionalPromptSections
    );

    // Read prompt content for spawner (avoids file read indirection in worker)
    const promptContent = await fs.promises.readFile(promptPath, 'utf-8');

    // Write session context (static identity file)
    const now = new Date().toISOString();
    const sessionFilePath = this.store.getSessionFilePath(sessionId);
    const context: SessionContext = {
      sessionId,
      issue: issueInfo,
      github: {
        owner: this.config.githubOwner,
        repo: this.config.githubRepo,
      },
      branch: branchName,
      worktreePath,
      commands: {
        update: `orch update --id ${issueNumber}`,
        heartbeat: `orch heartbeat --id ${issueNumber}`,
      },
      spawnedAt: now,
      sessionFilePath,
    };
    await this.store.writeSessionContext(worktreePath, context);

    // Register session
    const session: SessionState = {
      id: sessionId,
      issue: issueInfo,
      status: 'registered',
      mode,
      branch: branchName,
      worktreePath,
      startedAt: now,
      lastHeartbeat: now,
    };

    await this.store.save(session);

    // Spawn worker
    const spawnResult = await this.spawner.spawn({
      sessionId,
      issue: issueInfo,
      workingDirectory: worktreePath,
      promptFilePath: promptPath,
      promptContent,
      githubOwner: this.config.githubOwner,
      githubRepo: this.config.githubRepo,
      usePty: this.config.usePty,
    });

    if (!spawnResult.success) {
      // Clean up on failure
      await this.store.delete(sessionId);
      await this.gitUtils.removeWorktree(worktreePath);
      throw new Error(spawnResult.error ?? 'Failed to spawn worker');
    }

    // Update to working status with spawnId for status tracking
    const updatedSession: SessionState = {
      ...session,
      status: 'working',
      lastHeartbeat: new Date().toISOString(),
      spawnId: spawnResult.spawnId,
    };
    await this.store.save(updatedSession);

    return updatedSession;
  }

  /**
   * Restarts a session by spawning a fresh worker in the existing worktree.
   * Used for Ralph loop iterations and recovering stuck sessions.
   * @param sessionId - The session to restart
   * @param iteration - Optional iteration number for log file naming
   */
  async restart(sessionId: string, iteration?: number): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Allow restarting any session except terminal states
    const terminalStatuses = ['cancelled', 'deleting', 'deletion_failed'];
    if (terminalStatuses.includes(session.status)) {
      throw new Error(`Cannot restart ${session.status} sessions`);
    }

    // Check spawner availability
    if (!this.spawner.isAvailable()) {
      throw new Error(`Worker spawner (${this.spawner.getName()}) is not available`);
    }

    // Verify worktree still exists
    if (!fs.existsSync(session.worktreePath)) {
      throw new Error(`Worktree no longer exists at ${session.worktreePath}`);
    }

    // Re-read the prompt file
    const promptPath = path.join(session.worktreePath, '.claude', 'session-prompt.md');
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Worker prompt not found at ${promptPath}`);
    }
    const promptContent = await fs.promises.readFile(promptPath, 'utf-8');

    // Spawn a fresh worker in the existing worktree
    const spawnResult = await this.spawner.spawn({
      sessionId,
      issue: session.issue,
      workingDirectory: session.worktreePath,
      promptFilePath: promptPath,
      promptContent,
      githubOwner: this.config.githubOwner,
      githubRepo: this.config.githubRepo,
      iteration,
      usePty: this.config.usePty,
    });

    if (!spawnResult.success) {
      throw new Error(spawnResult.error ?? 'Failed to restart worker');
    }

    // Update status back to working with new spawnId
    const updatedSession: SessionState = {
      ...session,
      status: 'working',
      stuckReason: undefined, // Clear the stuck reason
      lastHeartbeat: new Date().toISOString(),
      spawnId: spawnResult.spawnId,
    };
    await this.store.save(updatedSession);

    return updatedSession;
  }

  /**
   * Lists all sessions (including completed).
   * Sessions are NEVER auto-deleted - only explicit user action removes them.
   * Adds worktreeMissing flag for UI to show warnings.
   */
  async list(): Promise<(SessionState & { worktreeMissing?: boolean })[]> {
    const sessions = await this.store.listAll();

    // Add worktreeMissing flag for UI, but NEVER auto-delete sessions
    return sessions.map(session => ({
      ...session,
      worktreeMissing: !fs.existsSync(session.worktreePath),
    }));
  }

  /**
   * Lists only running sessions (excludes complete/cancelled).
   */
  async listRunning(): Promise<SessionState[]> {
    const allSessions = await this.list();
    return allSessions.filter(s => s.status !== 'complete' && s.status !== 'cancelled');
  }

  /**
   * Lists sessions with cleanup info.
   * Sessions are NEVER auto-deleted - only explicit user action removes them.
   * cleanedIssueNumbers is kept for backwards compatibility but always empty.
   */
  async listWithCleanupInfo(): Promise<SessionListResult & { sessions: (SessionState & { worktreeMissing?: boolean })[] }> {
    const sessions = await this.store.listAll();

    // Add worktreeMissing flag for UI, but NEVER auto-delete sessions
    const enrichedSessions = sessions.map(session => ({
      ...session,
      worktreeMissing: !fs.existsSync(session.worktreePath),
    }));

    return {
      sessions: enrichedSessions,
      cleanedIssueNumbers: [], // No auto-cleanup - user must explicitly delete
    };
  }

  /**
   * Gets a session by ID.
   */
  async get(sessionId: string): Promise<SessionState | null> {
    return this.store.load(sessionId);
  }

  /**
   * Gets a session by PR number.
   */
  async getByPullRequest(prNumber: number): Promise<SessionState | null> {
    const sessions = await this.store.listAll();
    return sessions.find(s => this.extractPrNumber(s.pullRequestUrl) === prNumber) ?? null;
  }

  /**
   * Updates a session's status.
   */
  async update(
    sessionId: string,
    status: SessionStatus,
    options?: { reason?: string; prUrl?: string }
  ): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const now = new Date().toISOString();
    const updatedSession: SessionState = {
      ...session,
      status,
      stuckReason: status === 'stuck' ? options?.reason : undefined,
      pullRequestUrl: options?.prUrl ?? session.pullRequestUrl,
      lastHeartbeat: now,
    };

    await this.store.save(updatedSession);

    return updatedSession;
  }

  /**
   * Pauses a session.
   */
  async pause(sessionId: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Cannot pause completed or cancelled sessions
    if (session.status === 'complete') {
      throw new Error('Cannot pause a completed session');
    }
    if (session.status === 'cancelled') {
      throw new Error('Cannot pause a cancelled session');
    }

    if (session.status === 'paused') {
      return session; // Already paused
    }

    return this.update(sessionId, 'paused');
  }

  /**
   * Resumes a paused session.
   */
  async resume(sessionId: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    if (session.status !== 'paused') {
      return session; // Not paused
    }

    return this.update(sessionId, 'working');
  }

  /**
   * Deletes a session and its worktree.
   * Implements safe deletion order: worktree first, then session file.
   * For active sessions, first sets status to 'cancelled' to trigger the
   * session-watcher to kill the Claude process before removing the worktree.
   *
   * @param sessionId - Session to delete
   * @param options.keepWorktree - If true, don't remove worktree (deprecated, use deletionMode)
   * @param options.force - If true, delete session even if worktree cleanup fails
   * @param options.deletionMode - How aggressively to clean up (folder-only, with-local-branch, everything)
   */
  async delete(
    sessionId: string,
    options?: { keepWorktree?: boolean; force?: boolean; deletionMode?: DeletionMode }
  ): Promise<DeleteResult> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // If already in deleting state and not forcing, return current state
    if (session.status === 'deleting' && !options?.force) {
      return {
        success: false,
        sessionDeleted: false,
        worktreeRemoved: false,
        error: 'Deletion already in progress',
      };
    }

    // Save previous status for potential rollback
    const previousStatus = session.status;

    // For active sessions, first set status to 'cancelled' to trigger the
    // session-watcher to kill the Claude process
    const activeStatuses = ['registered', 'planning', 'planning_complete', 'working', 'shipping', 'reviews_in_progress', 'pr_ready', 'stuck', 'paused'];
    if (activeStatuses.includes(session.status) && !options?.keepWorktree) {
      const cancelledSession: SessionState = {
        ...session,
        status: 'cancelled',
        lastHeartbeat: new Date().toISOString(),
      };
      await this.store.save(cancelledSession);

      // Wait for the session-watcher to detect the status change and kill the process
      // The watcher polls every 1 second, so 2 seconds should be enough
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Transition to deleting state
    const deletingSession: SessionState = {
      ...session,
      status: 'deleting',
      previousStatus,
      lastHeartbeat: new Date().toISOString(),
    };
    await this.store.save(deletingSession);

    // Determine deletion mode (default to folder-only for backward compat)
    const deletionMode = options?.deletionMode ?? 'folder-only';
    const shouldRemoveWorktree = !options?.keepWorktree;

    // Attempt worktree removal if requested
    let worktreeRemoved = false;
    let worktreeError: string | undefined;
    let localBranchDeleted = false;
    let remoteBranchDeleted = false;

    if (shouldRemoveWorktree && fs.existsSync(session.worktreePath)) {
      const result = await this.gitUtils.removeWorktree(session.worktreePath);
      worktreeRemoved = result.success;
      worktreeError = result.error;
    } else {
      // Worktree doesn't exist or keepWorktree=true
      worktreeRemoved = true;
    }

    // If worktree removal failed and not forcing, transition to deletion_failed
    if (!worktreeRemoved && !options?.force) {
      const failedSession: SessionState = {
        ...session,
        status: 'deletion_failed',
        deletionError: worktreeError,
        previousStatus,
        lastHeartbeat: new Date().toISOString(),
      };
      await this.store.save(failedSession);

      return {
        success: false,
        sessionDeleted: false,
        worktreeRemoved: false,
        error: worktreeError,
        orphanedWorktreePath: session.worktreePath,
      };
    }

    // Delete branches based on deletion mode
    if (deletionMode === 'with-local-branch' || deletionMode === 'everything') {
      try {
        await this.gitUtils.deleteLocalBranch(session.branch, true);
        localBranchDeleted = true;
      } catch (error) {
        // Branch might not exist or is already deleted
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes('not found') && !msg.includes('does not exist')) {
          console.warn(`Failed to delete local branch ${session.branch}: ${msg}`);
        }
      }
    }

    if (deletionMode === 'everything') {
      try {
        await this.gitUtils.deleteRemoteBranch(session.branch);
        remoteBranchDeleted = true;
      } catch (error) {
        // Branch might not exist on remote
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes('not found') && !msg.includes('does not exist')) {
          console.warn(`Failed to delete remote branch ${session.branch}: ${msg}`);
        }
      }
    }

    // Delete session file
    await this.store.delete(sessionId);

    return {
      success: true,
      sessionDeleted: true,
      worktreeRemoved,
      localBranchDeleted,
      remoteBranchDeleted,
      // If force-deleted with failed worktree, note the potential orphan
      orphanedWorktreePath: worktreeRemoved ? undefined : session.worktreePath,
    };
  }

  /**
   * Retries deletion for a session in deletion_failed state.
   */
  async retryDelete(sessionId: string): Promise<DeleteResult> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    if (session.status !== 'deletion_failed') {
      throw new Error(`Session '${sessionId}' is not in deletion_failed state`);
    }

    return this.delete(sessionId);
  }

  /**
   * Rolls back a deletion_failed session to its previous state.
   */
  async rollbackDeletion(sessionId: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    if (session.status !== 'deletion_failed') {
      throw new Error(`Session '${sessionId}' is not in deletion_failed state`);
    }

    const previousStatus = session.previousStatus ?? 'stuck';

    const restoredSession: SessionState = {
      ...session,
      status: previousStatus,
      deletionError: undefined,
      previousStatus: undefined,
      lastHeartbeat: new Date().toISOString(),
    };

    await this.store.save(restoredSession);
    return restoredSession;
  }

  /**
   * Cleans up an orphaned worktree (worktree without session file).
   */
  async cleanupOrphan(worktreePath: string): Promise<WorktreeRemovalResult> {
    // Verify it's actually an orphan (worktree exists, no session)
    if (!fs.existsSync(worktreePath)) {
      return { success: true, notFound: true }; // Already gone
    }

    if (!GitUtils.isWorktree(worktreePath)) {
      return { success: false, error: 'Path is not a git worktree' };
    }

    // Try to read context to get session ID
    const context = await this.store.readSessionContext(worktreePath);
    if (context) {
      // Check if session actually exists
      const session = await this.store.load(context.sessionId);
      if (session) {
        return {
          success: false,
          error: `Session '${context.sessionId}' still exists - use delete() instead`,
        };
      }
    }

    // Remove the worktree
    return this.gitUtils.removeWorktree(worktreePath);
  }

  /**
   * Forwards a message to a worker.
   */
  async forward(sessionId: string, message: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Cannot forward to completed or cancelled sessions
    if (session.status === 'complete') {
      throw new Error('Cannot forward message to a completed session');
    }
    if (session.status === 'cancelled') {
      throw new Error('Cannot forward message to a cancelled session');
    }

    const now = new Date().toISOString();
    const updatedSession: SessionState = {
      ...session,
      forwardedMessage: message,
      lastHeartbeat: now,
    };

    await this.store.save(updatedSession);

    // Also write to worktree for worker to read
    await this.store.writeSessionState(session.worktreePath, {
      status: updatedSession.status,
      forwardedMessage: message,
      lastUpdated: now,
    });

    return updatedSession;
  }

  /**
   * Records a heartbeat from a worker.
   * Returns whether a forwarded message is waiting.
   */
  async heartbeat(sessionId: string): Promise<{ recorded: boolean; hasMessage: boolean }> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const updatedSession: SessionState = {
      ...session,
      lastHeartbeat: new Date().toISOString(),
    };

    await this.store.save(updatedSession);

    return {
      recorded: true,
      hasMessage: !!session.forwardedMessage,
    };
  }

  /**
   * Acknowledges a forwarded message, clearing it from the session.
   */
  async acknowledgeMessage(sessionId: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const now = new Date().toISOString();
    const updatedSession: SessionState = {
      ...session,
      forwardedMessage: undefined,
      lastHeartbeat: now,
    };

    await this.store.save(updatedSession);

    return updatedSession;
  }

  /**
   * Gets the git status for a session's worktree.
   * Diffs against the configured baseBranch to show cumulative changes.
   */
  async getWorktreeStatus(sessionId: string): Promise<WorktreeStatus | null> {
    const session = await this.store.load(sessionId);

    if (!session || !fs.existsSync(session.worktreePath)) {
      return null;
    }

    const baseBranch = this.config.baseBranch ?? 'origin/main';
    return this.gitUtils.getWorktreeStatus(session.worktreePath, baseBranch);
  }

  /**
   * Gets the state of a session's worktree for deletion safety checks.
   * Returns counts of uncommitted files and unpushed commits.
   */
  async getWorktreeState(sessionId: string): Promise<WorktreeState | null> {
    const session = await this.store.load(sessionId);

    if (!session || !fs.existsSync(session.worktreePath)) {
      return null;
    }

    return this.gitUtils.getWorktreeState(session.worktreePath);
  }

  /**
   * Checks if a session is stale (no heartbeat recently).
   */
  isStale(session: SessionState): boolean {
    const lastHeartbeat = new Date(session.lastHeartbeat).getTime();
    const now = Date.now();
    return now - lastHeartbeat > STALE_THRESHOLD_MS;
  }

  /**
   * Gets the sessions directory path (for file watching).
   */
  getSessionsDir(): string {
    return this.store.getSessionsDir();
  }

  /**
   * Gets the status of a spawned worker.
   * Used by Ralph loop to detect when workers have stopped.
   */
  async getWorkerStatus(spawnId: string): Promise<{ running: boolean; exitCode?: number }> {
    return this.spawner.getStatus(spawnId);
  }

  // ============================================
  // Private helper methods
  // ============================================

  /**
   * Fetches an issue from GitHub using gh CLI.
   */
  private async fetchIssue(issueNumber: number): Promise<{ title: string; body: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('gh', [
        'issue', 'view', issueNumber.toString(),
        '--repo', `${this.config.githubOwner}/${this.config.githubRepo}`,
        '--json', 'title,body',
      ], {
        cwd: this.config.repoRoot,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to fetch issue #${issueNumber}: ${stderr}`));
          return;
        }

        try {
          const issue = JSON.parse(stdout);
          resolve({
            title: issue.title || `Issue #${issueNumber}`,
            body: issue.body || '',
          });
        } catch (error) {
          reject(new Error(`Failed to parse issue response: ${error}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to run gh CLI: ${error.message}`));
      });
    });
  }

  /**
   * Writes the worker prompt to the worktree.
   */
  private async writeWorkerPrompt(
    worktreePath: string,
    issue: IssueRef,
    branchName: string,
    mode: ExecutionMode = 'manual',
    additionalPromptSections?: string[]
  ): Promise<string> {
    const claudeDir = path.join(worktreePath, '.claude');

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    const promptPath = path.join(claudeDir, 'session-prompt.md');

    // Use the prompt builder to generate the prompt content
    const prompt = this.promptBuilder.build({
      githubOwner: this.config.githubOwner,
      githubRepo: this.config.githubRepo,
      issue,
      branchName,
      mode,
      additionalSections: additionalPromptSections,
    });

    await fs.promises.writeFile(promptPath, prompt, 'utf-8');
    return promptPath;
  }

  /**
   * Extracts PR number from a GitHub PR URL.
   */
  private extractPrNumber(prUrl: string | undefined): number | null {
    if (!prUrl) {
      return null;
    }

    const match = prUrl.match(/\/pull\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }
}

/**
 * Creates a SessionService from a project's orchestration config.
 */
export async function createSessionService(configPath?: string): Promise<SessionService> {
  // Find config file
  const cwd = process.cwd();
  const configFile = configPath ?? path.join(cwd, 'orchestration.config.json');

  if (!fs.existsSync(configFile)) {
    throw new Error(`Orchestration config not found at ${configFile}`);
  }

  const config = JSON.parse(await fs.promises.readFile(configFile, 'utf-8'));

  // Find repo root
  const repoRoot = GitUtils.findRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error('Could not find git repository root');
  }

  // If sessionsDir is provided in config, extract the base orchestration directory.
  // Config sessionsDir is like ~/.orchestration/{project}/sessions
  // SessionStore expects baseDir to be ~/.orchestration (the root, without project/sessions)
  let baseDir: string | undefined;
  if (config.dashboard?.sessionsDir) {
    const sessionsDir = config.dashboard.sessionsDir.replace('~', os.homedir());
    // Go up 2 directories: sessions -> project -> orchestration root
    baseDir = path.dirname(path.dirname(sessionsDir));
  }

  return new SessionService({
    projectName: config.project?.github?.repo ?? path.basename(repoRoot),
    repoRoot,
    githubOwner: config.project?.github?.owner,
    githubRepo: config.project?.github?.repo,
    worktreePrefix: config.project?.worktreePrefix,
    baseDir,
    cliCommand: config.worker?.cliCommand ?? 'orch',
    baseBranch: config.project?.baseBranch ?? 'origin/main',
  });
}
