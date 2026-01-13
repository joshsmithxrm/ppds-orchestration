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
  ExecutionMode,
  IssueRef,
  getIssueNumbers,
  STALE_THRESHOLD_MS,
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
}

/**
 * Options for spawning a new worker session.
 */
export interface SpawnOptions {
  /** Execution mode: 'single' (autonomous) or 'ralph' (iterative). Default: 'single'. */
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
   * Spawns a new worker session for one or more issues.
   * @param issueNumbers - Single issue number or array of issue numbers
   * @param options - Spawn options
   */
  async spawn(issueNumbers: number | number[], options?: SpawnOptions): Promise<SessionState> {
    // Normalize to array
    const issueNums = Array.isArray(issueNumbers) ? issueNumbers : [issueNumbers];

    if (issueNums.length === 0) {
      throw new Error('At least one issue number is required');
    }

    const primaryIssue = issueNums[0];
    const sessionId = primaryIssue.toString();
    const mode = options?.mode ?? 'single';

    // Check for overlap with existing combined sessions
    // (e.g., if session [2,4,5] exists and we try to spawn [1,2,3], issue #2 conflicts)
    const allSessions = await this.store.listAll();
    for (const existing of allSessions) {
      if (existing.status === 'complete' || existing.status === 'cancelled') continue;
      const existingIssues = getIssueNumbers(existing);
      const overlap = issueNums.filter(n => existingIssues.includes(n));
      if (overlap.length > 0) {
        throw new Error(
          `Issue(s) ${overlap.map(n => `#${n}`).join(', ')} already in active session '${existing.id}'`
        );
      }
    }

    // Clean up any completed/cancelled sessions with matching IDs
    for (const issueNum of issueNums) {
      const existingId = issueNum.toString();
      if (this.store.exists(existingId)) {
        const existing = await this.store.load(existingId);
        if (existing && (existing.status === 'complete' || existing.status === 'cancelled')) {
          // Session is complete/cancelled - allow re-spawn by deleting old session
          await this.store.delete(existingId);
        }
      }
    }

    // Check spawner availability
    if (!this.spawner.isAvailable()) {
      throw new Error(`Worker spawner (${this.spawner.getName()}) is not available`);
    }

    // Fetch all issues from GitHub in parallel
    const issueInfos = await Promise.all(
      issueNums.map(async (num) => {
        const info = await this.fetchIssue(num);
        return { number: num, title: info.title, body: info.body };
      })
    );

    // Generate branch and worktree names based on issue count
    const worktreePrefix = this.config.worktreePrefix ?? `${path.basename(this.config.repoRoot)}-`;
    let branchName: string;
    let worktreeName: string;

    if (issueNums.length === 1) {
      branchName = `issue-${primaryIssue}`;
      worktreeName = `${worktreePrefix}issue-${primaryIssue}`;
    } else {
      const issuesSuffix = issueNums.join('-');
      branchName = `issues-${issuesSuffix}`;
      worktreeName = `${worktreePrefix}issues-${issuesSuffix}`;
    }

    const worktreePath = path.join(path.dirname(this.config.repoRoot), worktreeName);

    await this.gitUtils.createWorktree(
      worktreePath,
      branchName,
      this.config.baseBranch ?? 'origin/main'
    );

    // Write worker prompt
    const promptPath = await this.writeWorkerPrompt(
      worktreePath,
      issueInfos,
      branchName,
      mode,
      options?.additionalPromptSections
    );

    // Write session context (static identity file)
    const now = new Date().toISOString();
    const sessionFilePath = this.store.getSessionFilePath(sessionId);
    const context: SessionContext = {
      sessionId,
      issues: issueInfos,
      github: {
        owner: this.config.githubOwner,
        repo: this.config.githubRepo,
      },
      branch: branchName,
      worktreePath,
      commands: {
        update: `orch update --id ${primaryIssue}`,
        heartbeat: `orch heartbeat --id ${primaryIssue}`,
      },
      spawnedAt: now,
      sessionFilePath,
    };
    await this.store.writeSessionContext(worktreePath, context);

    // Register session
    const session: SessionState = {
      id: sessionId,
      issues: issueInfos,
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
      issues: issueInfos,
      workingDirectory: worktreePath,
      promptFilePath: promptPath,
      githubOwner: this.config.githubOwner,
      githubRepo: this.config.githubRepo,
    });

    if (!spawnResult.success) {
      // Clean up on failure
      await this.store.delete(sessionId);
      await this.gitUtils.removeWorktree(worktreePath);
      throw new Error(spawnResult.error ?? 'Failed to spawn worker');
    }

    // Update to working status
    const updatedSession: SessionState = {
      ...session,
      status: 'working',
      lastHeartbeat: new Date().toISOString(),
    };
    await this.store.save(updatedSession);

    return updatedSession;
  }

  /**
   * Restarts a stuck session by spawning a fresh worker in the existing worktree.
   * The worker will see any forwarded guidance and continue from the current state.
   */
  async restart(sessionId: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    if (session.status !== 'stuck') {
      throw new Error(`Can only restart stuck sessions (current status: ${session.status})`);
    }

    // Check spawner availability
    if (!this.spawner.isAvailable()) {
      throw new Error(`Worker spawner (${this.spawner.getName()}) is not available`);
    }

    // Verify worktree still exists
    if (!fs.existsSync(session.worktreePath)) {
      throw new Error(`Worktree no longer exists at ${session.worktreePath}`);
    }

    // Re-read the prompt file path
    const promptPath = path.join(session.worktreePath, '.claude', 'session-prompt.md');
    if (!fs.existsSync(promptPath)) {
      throw new Error(`Worker prompt not found at ${promptPath}`);
    }

    // Spawn a fresh worker in the existing worktree
    const spawnResult = await this.spawner.spawn({
      sessionId,
      issues: session.issues,
      workingDirectory: session.worktreePath,
      promptFilePath: promptPath,
      githubOwner: this.config.githubOwner,
      githubRepo: this.config.githubRepo,
    });

    if (!spawnResult.success) {
      throw new Error(spawnResult.error ?? 'Failed to restart worker');
    }

    // Update status back to working
    const updatedSession: SessionState = {
      ...session,
      status: 'working',
      stuckReason: undefined, // Clear the stuck reason
      lastHeartbeat: new Date().toISOString(),
    };
    await this.store.save(updatedSession);

    return updatedSession;
  }

  /**
   * Lists all sessions (including completed).
   */
  async list(): Promise<SessionState[]> {
    const sessions = await this.store.listAll();

    // Clean up orphaned sessions (worktrees that no longer exist)
    const validSessions: SessionState[] = [];

    for (const session of sessions) {
      // For completed/cancelled sessions, keep them even if worktree is gone
      if (session.status === 'complete' || session.status === 'cancelled') {
        validSessions.push(session);
      } else if (fs.existsSync(session.worktreePath)) {
        validSessions.push(session);
      } else {
        // Worktree was removed externally, clean up session
        await this.store.delete(session.id);
      }
    }

    return validSessions;
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
   */
  async listWithCleanupInfo(): Promise<SessionListResult> {
    const sessions = await this.store.listAll();
    const validSessions: SessionState[] = [];
    const cleanedIssueNumbers: number[] = [];

    for (const session of sessions) {
      // For completed/cancelled sessions, keep them even if worktree is gone
      if (session.status === 'complete' || session.status === 'cancelled') {
        validSessions.push(session);
      } else if (fs.existsSync(session.worktreePath)) {
        validSessions.push(session);
      } else {
        // Worktree was removed externally, clean up session
        await this.store.delete(session.id);
        cleanedIssueNumbers.push(...getIssueNumbers(session));
      }
    }

    return { sessions: validSessions, cleanedIssueNumbers };
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
   * This consolidates the former cancel() and delete() methods.
   */
  async delete(sessionId: string, options?: { keepWorktree?: boolean }): Promise<void> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Remove worktree if it exists and keepWorktree is not true
    if (!options?.keepWorktree && fs.existsSync(session.worktreePath)) {
      await this.gitUtils.removeWorktree(session.worktreePath);
    }

    // Remove session file
    await this.store.delete(sessionId);
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
   */
  async getWorktreeStatus(sessionId: string): Promise<WorktreeStatus | null> {
    const session = await this.store.load(sessionId);

    if (!session || !fs.existsSync(session.worktreePath)) {
      return null;
    }

    return this.gitUtils.getWorktreeStatus(session.worktreePath);
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
    issues: IssueRef[],
    branchName: string,
    mode: ExecutionMode = 'single',
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
      issues,
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
