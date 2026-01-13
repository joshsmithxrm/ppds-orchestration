import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import {
  SessionState,
  SessionStatus,
  SessionContext,
  SessionDynamicState,
  SessionListResult,
  WorktreeStatus,
  ExecutionMode,
  STALE_THRESHOLD_MS,
} from './types.js';
import { SessionStore } from './session-store.js';
import { GitUtils } from '../git/git-utils.js';
import { WorkerSpawner } from '../spawner/worker-spawner.js';
import { createSpawner } from '../spawner/windows-terminal-spawner.js';

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
  private readonly config: SessionServiceConfig;

  constructor(config: SessionServiceConfig) {
    this.config = config;
    this.store = new SessionStore(config.projectName, config.baseDir);
    this.gitUtils = new GitUtils(config.repoRoot);
    this.spawner = config.spawner ?? createSpawner();
  }

  /**
   * Spawns a new worker session for an issue.
   */
  async spawn(issueNumber: number, options?: SpawnOptions): Promise<SessionState> {
    const sessionId = issueNumber.toString();
    const mode = options?.mode ?? 'single';

    // Check if session already exists
    if (this.store.exists(sessionId)) {
      throw new Error(`Session for issue #${issueNumber} already exists`);
    }

    // Check spawner availability
    if (!this.spawner.isAvailable()) {
      throw new Error(`Worker spawner (${this.spawner.getName()}) is not available`);
    }

    // Fetch issue from GitHub
    const issueInfo = await this.fetchIssue(issueNumber);

    // Create worktree
    const worktreePrefix = this.config.worktreePrefix ?? `${path.basename(this.config.repoRoot)}-issue-`;
    const worktreeName = `${worktreePrefix}${issueNumber}`;
    const branchName = `issue-${issueNumber}`;
    const worktreePath = path.join(path.dirname(this.config.repoRoot), worktreeName);

    await this.gitUtils.createWorktree(
      worktreePath,
      branchName,
      this.config.baseBranch ?? 'origin/main'
    );

    // Write worker prompt
    const promptPath = await this.writeWorkerPrompt(
      worktreePath,
      issueNumber,
      issueInfo.title,
      issueInfo.body,
      branchName,
      mode,
      options?.additionalPromptSections
    );

    // Write session context (static identity file)
    const now = new Date().toISOString();
    const context: SessionContext = {
      sessionId,
      issueNumber,
      issueTitle: issueInfo.title,
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
    };
    await this.store.writeSessionContext(worktreePath, context);

    // Write initial session state (dynamic state file)
    const dynamicState: SessionDynamicState = {
      status: 'registered',
      lastUpdated: now,
    };
    await this.store.writeSessionState(worktreePath, dynamicState);

    // Register session
    const session: SessionState = {
      id: sessionId,
      issueNumber,
      issueTitle: issueInfo.title,
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
      issueNumber,
      issueTitle: issueInfo.title,
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
    await this.store.writeSessionState(worktreePath, {
      status: 'working',
      lastUpdated: new Date().toISOString(),
    });

    return updatedSession;
  }

  /**
   * Lists active sessions.
   */
  async list(): Promise<SessionState[]> {
    const sessions = await this.store.listActive();

    // Clean up orphaned sessions (worktrees that no longer exist)
    const validSessions: SessionState[] = [];

    for (const session of sessions) {
      if (fs.existsSync(session.worktreePath)) {
        validSessions.push(session);
      } else {
        // Worktree was removed externally, clean up session
        await this.store.delete(session.id);
      }
    }

    return validSessions;
  }

  /**
   * Lists sessions with cleanup info.
   */
  async listWithCleanupInfo(): Promise<SessionListResult> {
    const sessions = await this.store.listActive();
    const validSessions: SessionState[] = [];
    const cleanedIssueNumbers: number[] = [];

    for (const session of sessions) {
      if (fs.existsSync(session.worktreePath)) {
        validSessions.push(session);
      } else {
        // Worktree was removed externally, clean up session
        await this.store.delete(session.id);
        cleanedIssueNumbers.push(session.issueNumber);
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

    // Also update worktree state file
    if (fs.existsSync(session.worktreePath)) {
      await this.store.writeSessionState(session.worktreePath, {
        status,
        forwardedMessage: session.forwardedMessage,
        lastUpdated: now,
      });
    }

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
   * Cancels a session.
   */
  async cancel(sessionId: string, options?: { keepWorktree?: boolean }): Promise<void> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    // Skip intermediate 'cancelled' status update - delete directly to avoid
    // race condition where watcher broadcasts 'cancelled' before deletion

    // Remove worktree unless keepWorktree is true
    if (!options?.keepWorktree && fs.existsSync(session.worktreePath)) {
      await this.gitUtils.removeWorktree(session.worktreePath);
    }

    // Remove session file
    await this.store.delete(sessionId);
  }

  /**
   * Cancels all active sessions.
   */
  async cancelAll(options?: { keepWorktrees?: boolean }): Promise<number> {
    const sessions = await this.list();
    let count = 0;

    for (const session of sessions) {
      if (['working', 'stuck', 'paused', 'registered', 'planning', 'planning_complete'].includes(session.status)) {
        await this.cancel(session.id, { keepWorktree: options?.keepWorktrees });
        count++;
      }
    }

    return count;
  }

  /**
   * Forwards a message to a worker.
   */
  async forward(sessionId: string, message: string): Promise<SessionState> {
    const session = await this.store.load(sessionId);

    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const now = new Date().toISOString();
    const updatedSession: SessionState = {
      ...session,
      forwardedMessage: message,
      lastHeartbeat: now,
    };

    await this.store.save(updatedSession);

    // Update worktree state file
    if (fs.existsSync(session.worktreePath)) {
      await this.store.writeSessionState(session.worktreePath, {
        status: session.status,
        forwardedMessage: message,
        lastUpdated: now,
      });
    }

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

    // Clear in worktree state file too
    if (fs.existsSync(session.worktreePath)) {
      await this.store.writeSessionState(session.worktreePath, {
        status: session.status,
        forwardedMessage: undefined,
        lastUpdated: now,
      });
    }

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
    issueNumber: number,
    title: string,
    body: string,
    branchName: string,
    mode: ExecutionMode = 'single',
    additionalPromptSections?: string[]
  ): Promise<string> {
    const claudeDir = path.join(worktreePath, '.claude');

    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    const promptPath = path.join(claudeDir, 'session-prompt.md');
    const cli = this.config.cliCommand ?? 'orch';
    let prompt = `# Session: Issue #${issueNumber}

## Repository Context

**IMPORTANT:** For all GitHub operations (CLI and MCP tools), use these values:
- Owner: \`${this.config.githubOwner}\`
- Repo: \`${this.config.githubRepo}\`
- Issue: \`#${issueNumber}\`
- Branch: \`${branchName}\`

Examples:
\`\`\`bash
gh issue view ${issueNumber} --repo ${this.config.githubOwner}/${this.config.githubRepo}
gh pr create --repo ${this.config.githubOwner}/${this.config.githubRepo} ...
\`\`\`

## Issue
**${title}**

${body}

## Status Reporting

**Report status at each phase transition** by updating \`session-state.json\` in the worktree root.

| Phase | Status Value |
|-------|--------------|
| Starting | \`planning\` |
| Plan complete | \`planning_complete\` |
| Implementing | \`working\` |
| Stuck | \`stuck\` (also set \`stuckReason\`) |
| Complete | \`complete\` |

**How to update status:**
1. Read \`session-state.json\`
2. Update the \`status\` field to the new value
3. If stuck, also set \`stuckReason\` to explain what you need
4. Write the updated JSON back to \`session-state.json\`

**Note:** \`/ship\` automatically updates status to \`shipping\` → \`reviews_in_progress\` → \`complete\`.

## Workflow

### Phase 1: Planning
1. **First:** Update \`session-state.json\` with \`"status": "planning"\`
2. Read and understand the issue requirements
3. Explore the codebase to understand existing patterns
4. Create a detailed implementation plan
5. Write your plan to \`.claude/worker-plan.md\`
6. **Then:** Update \`session-state.json\` with \`"status": "planning_complete"\`

### Message Check Protocol

Check for forwarded messages at these points:
1. **After each phase** - planning complete, before implementation, after tests
2. **When stuck** - check every 5 minutes while waiting for guidance
3. **Before major decisions** - architectural choices, security implementations

**How to check:** Read \`session-state.json\` and check the \`forwardedMessage\` field.

**If message exists:**
1. Read and incorporate the guidance into your approach
2. Clear the message by setting \`forwardedMessage\` to \`null\` in \`session-state.json\`
3. Continue with your work (the guidance may unstick you)

**Important:** When your status is \`stuck\`, check for messages periodically - the orchestrator may have sent guidance that unblocks you.

### Phase 3: Implementation
1. **First:** Update \`session-state.json\` with \`"status": "working"\`
2. Follow your plan in \`.claude/worker-plan.md\`
3. Build and test your changes
4. Create PR via \`/ship\` (handles remaining status updates automatically)

### Domain Gates
If you encounter these, set status to \`stuck\` with a clear reason:
- Auth/Security decisions
- Performance-critical code
- Breaking changes
- Data migration

**Example:** Update \`session-state.json\` with \`"status": "stuck"\` and \`"stuckReason": "Need auth decision: should we use JWT or session tokens?"\`

## Reference
- Follow CLAUDE.md for coding standards
- Build must pass before shipping
- Tests must pass before shipping
`;

    // Add mode-specific instructions for Ralph loop
    if (mode === 'ralph') {
      prompt += `
## Ralph Loop Mode

This session is running in **Ralph loop mode**. This means:
- You will work on ONE task from the implementation plan, then exit
- The orchestrator will re-spawn you for the next task
- Each spawn is a fresh context - you won't remember previous iterations

**Each iteration:**
1. Read \`.claude/worker-plan.md\` for the implementation plan
2. Find the next incomplete task
3. Complete that single task
4. Commit your changes
5. Update \`session-state.json\` in your worktree root with \`{ "status": "complete" }\`
6. Exit (the orchestrator will re-spawn you if more tasks remain)

**Important:** Do NOT try to complete all tasks in one go. Complete exactly ONE task per iteration.
`;
    }

    // Add additional prompt sections from hooks
    if (additionalPromptSections && additionalPromptSections.length > 0) {
      prompt += '\n## Additional Instructions\n\n';
      prompt += additionalPromptSections.join('\n\n');
      prompt += '\n';
    }

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

  return new SessionService({
    projectName: config.project?.github?.repo ?? path.basename(repoRoot),
    repoRoot,
    githubOwner: config.project?.github?.owner,
    githubRepo: config.project?.github?.repo,
    worktreePrefix: config.project?.worktreePrefix,
    baseDir: config.dashboard?.sessionsDir?.replace('~', os.homedir()),
    cliCommand: config.worker?.cliCommand ?? 'orch',
    baseBranch: config.project?.baseBranch ?? 'origin/main',
  });
}
