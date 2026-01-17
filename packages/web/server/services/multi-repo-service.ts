import * as path from 'node:path';
import {
  CentralConfig,
  RepoConfig,
  SessionService,
  SessionState,
  SessionStatus,
  SessionWatcher,
  SessionStore,
  GitUtils,
  getRepoEffectiveConfig,
  ExecutionMode,
  HookExecutor,
  OrphanedWorktree,
  DeleteResult,
  DockerSpawner,
  WorkerSpawner,
} from '@ppds-orchestration/core';

export interface MultiRepoSession extends SessionState {
  repoId: string;
}

export type SessionEventCallback = (
  event: 'add' | 'update' | 'remove',
  repoId: string,
  session: SessionState | null,
  sessionId: string
) => void;

/**
 * Service that manages sessions across multiple repositories.
 */
export class MultiRepoService {
  private services: Map<string, SessionService> = new Map();
  private watchers: Map<string, SessionWatcher> = new Map();
  private previousStatus: Map<string, SessionStatus> = new Map(); // Track status for hook execution
  private config: CentralConfig;
  private eventCallbacks: SessionEventCallback[] = [];
  private hookExecutor: HookExecutor = new HookExecutor();

  constructor(config: CentralConfig) {
    this.config = config;
    // Call initialize() after construction to complete setup
  }

  /**
   * Initialize a SessionService for each configured repo.
   */
  private async initializeServices(): Promise<void> {
    for (const [repoId, repoConfig] of Object.entries(this.config.repos)) {
      try {
        const service = await this.createServiceForRepo(repoId, repoConfig);
        this.services.set(repoId, service);
        console.log(`Initialized service for repo: ${repoId}`);
      } catch (error) {
        console.error(`Failed to initialize service for ${repoId}:`, error);
      }
    }
  }

  /**
   * Initialize the service (must be called after construction).
   * Detects orphaned worktrees on startup.
   */
  async initialize(): Promise<void> {
    await this.initializeServices();

    // Detect orphans on startup (log only, don't auto-cleanup)
    try {
      const orphans = await this.reconcileOrphans();
      if (orphans.length > 0) {
        console.warn(`Detected ${orphans.length} orphaned worktree(s) on startup:`);
        for (const orphan of orphans) {
          const issueInfo = orphan.issueNumber
            ? ` (issue: #${orphan.issueNumber})`
            : '';
          console.warn(`  - ${path.basename(orphan.worktreePath)}${issueInfo}`);
        }
        console.warn('Use the dashboard to clean up orphaned worktrees.');
      }
    } catch (error) {
      console.error('Error during orphan detection:', error);
    }
  }

  /**
   * Create a SessionService for a specific repo.
   */
  private async createServiceForRepo(
    repoId: string,
    repoConfig: RepoConfig
  ): Promise<SessionService> {
    // Try to detect GitHub info from git remote if not configured
    let githubOwner = repoConfig.githubOwner;
    let githubRepo = repoConfig.githubRepo;

    if (!githubOwner || !githubRepo) {
      try {
        const gitUtils = new GitUtils(repoConfig.path);
        const remoteUrl = await gitUtils.getRemoteUrl('origin');
        if (remoteUrl) {
          const parsed = GitUtils.parseGitHubUrl(remoteUrl);
          if (parsed) {
            githubOwner = githubOwner ?? parsed.owner;
            githubRepo = githubRepo ?? parsed.repo;
          }
        }
      } catch {
        // Ignore git detection errors
      }
    }

    if (!githubOwner || !githubRepo) {
      throw new Error(`GitHub owner/repo not configured for ${repoId}`);
    }

    const effectiveConfig = getRepoEffectiveConfig(this.config, repoId);

    // Create spawner based on config (spawner is part of ralph config)
    let spawner: WorkerSpawner | undefined;
    if (effectiveConfig.ralph.spawner?.type === 'docker') {
      spawner = new DockerSpawner(effectiveConfig.ralph.spawner.docker);
    }
    // If spawner is undefined, SessionService will use createSpawner() default

    return new SessionService({
      projectName: repoId,
      repoRoot: repoConfig.path,
      githubOwner,
      githubRepo,
      worktreePrefix: repoConfig.worktreePrefix,
      baseBranch: repoConfig.baseBranch,
      cliCommand: effectiveConfig.cliCommand,
      spawner,
      usePty: effectiveConfig.ralph.spawner?.usePty,
    });
  }

  /**
   * Get service for a specific repo.
   */
  getService(repoId: string): SessionService {
    const service = this.services.get(repoId);
    if (!service) {
      throw new Error(`No service configured for repo: ${repoId}`);
    }
    return service;
  }

  /**
   * List all repos.
   */
  listRepos(): Array<{
    id: string;
    config: RepoConfig;
    hasService: boolean;
  }> {
    return Object.entries(this.config.repos).map(([id, config]) => ({
      id,
      config,
      hasService: this.services.has(id),
    }));
  }

  /**
   * List all sessions across all repos.
   */
  async listAllSessions(options?: {
    repoIds?: string[];
    includeCompleted?: boolean;
  }): Promise<MultiRepoSession[]> {
    const results: MultiRepoSession[] = [];
    const repoIds = options?.repoIds ?? Array.from(this.services.keys());

    for (const repoId of repoIds) {
      const service = this.services.get(repoId);
      if (!service) continue;

      try {
        const sessions = await service.list();
        for (const session of sessions) {
          if (
            !options?.includeCompleted &&
            ['complete', 'cancelled'].includes(session.status)
          ) {
            continue;
          }
          results.push({ ...session, repoId });
        }
      } catch (error) {
        console.error(`Error listing sessions for ${repoId}:`, error);
      }
    }

    return results;
  }

  /**
   * Get a specific session.
   */
  async getSession(
    repoId: string,
    sessionId: string
  ): Promise<SessionState | null> {
    const service = this.getService(repoId);
    return service.get(sessionId);
  }

  /**
   * Get session with worktree status.
   */
  async getSessionWithStatus(
    repoId: string,
    sessionId: string
  ): Promise<(SessionState & { worktreeStatus?: SessionState['worktreeStatus'] }) | null> {
    const service = this.getService(repoId);
    const session = await service.get(sessionId);
    if (!session) return null;

    const worktreeStatus = await service.getWorktreeStatus(sessionId);
    return { ...session, worktreeStatus: worktreeStatus ?? undefined };
  }

  /**
   * Spawn a new worker for an issue.
   * @param repoId - Repository ID
   * @param issueNumber - Issue number to work on
   * @param mode - Execution mode ('manual' or 'autonomous')
   */
  async spawn(
    repoId: string,
    issueNumber: number,
    mode: ExecutionMode = 'manual'
  ): Promise<SessionState> {
    const service = this.getService(repoId);

    // Get prompt hooks if configured
    const effectiveConfig = getRepoEffectiveConfig(this.config, repoId);
    const additionalPromptSections: string[] = [];

    // Add onSpawn prompt hook if configured
    const onSpawnHook = effectiveConfig.hooks['onSpawn'];
    if (onSpawnHook && onSpawnHook.type === 'prompt') {
      additionalPromptSections.push(onSpawnHook.value);
    }

    // Add onTest prompt hook if configured
    const onTestHook = effectiveConfig.hooks['onTest'];
    if (onTestHook && onTestHook.type === 'prompt') {
      additionalPromptSections.push(onTestHook.value);
    }

    const session = await service.spawn(issueNumber, { mode, additionalPromptSections });

    // Execute onSpawn command hook after successful spawn
    await this.executeHook('onSpawn', repoId, session);

    return session;
  }

  /**
   * Update session status.
   */
  async updateStatus(
    repoId: string,
    sessionId: string,
    status: SessionStatus,
    options?: { reason?: string; prUrl?: string }
  ): Promise<SessionState> {
    const service = this.getService(repoId);
    const session = await service.update(sessionId, status, options);

    // Execute hooks based on status change
    if (status === 'stuck') {
      await this.executeHook('onStuck', repoId, session);
    } else if (status === 'complete') {
      await this.executeHook('onComplete', repoId, session);
    } else if (status === 'shipping' && options?.prUrl) {
      await this.executeHook('onShip', repoId, session);
    }

    return session;
  }

  /**
   * Get worker status (running/stopped).
   * Used by Ralph loop to detect when workers have exited.
   */
  async getWorkerStatus(
    repoId: string,
    spawnId: string
  ): Promise<{ running: boolean; exitCode?: number }> {
    const service = this.getService(repoId);
    return service.getWorkerStatus(spawnId);
  }

  /**
   * Restart an existing session (for Ralph loop iterations).
   * Spawns a fresh worker in the existing worktree.
   */
  async restart(
    repoId: string,
    sessionId: string,
    iteration?: number
  ): Promise<SessionState> {
    const service = this.getService(repoId);
    return service.restart(sessionId, iteration);
  }

  /**
   * Forward message to worker.
   */
  async forward(
    repoId: string,
    sessionId: string,
    message: string
  ): Promise<SessionState> {
    const service = this.getService(repoId);
    return service.forward(sessionId, message);
  }

  /**
   * Pause session.
   */
  async pause(repoId: string, sessionId: string): Promise<SessionState> {
    const service = this.getService(repoId);
    return service.pause(sessionId);
  }

  /**
   * Resume session.
   */
  async resume(repoId: string, sessionId: string): Promise<SessionState> {
    const service = this.getService(repoId);
    return service.resume(sessionId);
  }

  /**
   * Delete a session with safe cleanup.
   * @param repoId - Repository ID
   * @param sessionId - Session ID to delete
   * @param options.keepWorktree - If true, don't remove worktree
   * @param options.force - If true, delete session even if worktree cleanup fails
   */
  async delete(
    repoId: string,
    sessionId: string,
    options?: { keepWorktree?: boolean; force?: boolean }
  ): Promise<DeleteResult> {
    const service = this.getService(repoId);
    return service.delete(sessionId, options);
  }

  /**
   * Retry deletion for a session in deletion_failed state.
   */
  async retryDelete(repoId: string, sessionId: string): Promise<DeleteResult> {
    const service = this.getService(repoId);
    return service.retryDelete(sessionId);
  }

  /**
   * Roll back a deletion_failed session to its previous state.
   */
  async rollbackDeletion(repoId: string, sessionId: string): Promise<SessionState> {
    const service = this.getService(repoId);
    return service.rollbackDeletion(sessionId);
  }

  /**
   * Clean up an orphaned worktree.
   */
  async cleanupOrphan(
    repoId: string,
    worktreePath: string
  ): Promise<{ success: boolean; error?: string }> {
    const service = this.getService(repoId);
    return service.cleanupOrphan(worktreePath);
  }

  /**
   * Detect orphaned worktrees across all repos.
   * An orphan is a worktree that matches our naming convention but has no session file.
   */
  async reconcileOrphans(): Promise<OrphanedWorktree[]> {
    const orphans: OrphanedWorktree[] = [];

    for (const [repoId, repoConfig] of Object.entries(this.config.repos)) {
      try {
        const repoOrphans = await this.detectOrphansForRepo(repoId, repoConfig);
        orphans.push(...repoOrphans);
      } catch (error) {
        console.error(`Error detecting orphans for ${repoId}:`, error);
      }
    }

    return orphans;
  }

  /**
   * Detect orphaned worktrees for a specific repo.
   */
  private async detectOrphansForRepo(
    repoId: string,
    repoConfig: RepoConfig
  ): Promise<OrphanedWorktree[]> {
    const gitUtils = new GitUtils(repoConfig.path);
    const service = this.services.get(repoId);
    if (!service) return [];

    let worktrees: Array<{ path: string; branch: string }>;
    try {
      worktrees = await gitUtils.listWorktrees();
    } catch {
      return []; // Can't list worktrees, skip
    }

    const sessions = await service.list();
    const sessionWorktreePaths = new Set(
      sessions.map(s => path.normalize(s.worktreePath).toLowerCase())
    );

    const orphans: OrphanedWorktree[] = [];
    const worktreePrefix = repoConfig.worktreePrefix ?? `${path.basename(repoConfig.path)}-`;

    for (const wt of worktrees) {
      // Skip the main worktree (the repo itself)
      if (path.normalize(wt.path).toLowerCase() === path.normalize(repoConfig.path).toLowerCase()) {
        continue;
      }

      // Check if this looks like an orchestration worktree
      const wtName = path.basename(wt.path);
      if (!wtName.startsWith(worktreePrefix)) {
        continue;
      }

      // Check if there's a corresponding session
      const normalizedPath = path.normalize(wt.path).toLowerCase();
      if (sessionWorktreePaths.has(normalizedPath)) {
        continue;
      }

      // This is an orphan - try to recover context
      const store = new SessionStore(repoId);
      let issueNumber: number | undefined;
      let sessionId: string | undefined;
      let contextError: string | undefined;

      try {
        const context = await store.readSessionContext(wt.path);
        if (context) {
          issueNumber = context.issue.number;
          sessionId = context.sessionId;
        }
      } catch (error) {
        contextError = error instanceof Error ? error.message : String(error);
      }

      orphans.push({
        repoId,
        worktreePath: wt.path,
        branchName: wt.branch,
        issueNumber,
        sessionId,
        detectedAt: new Date().toISOString(),
        contextError,
      });
    }

    return orphans;
  }

  /**
   * Get aggregate stats across all repos.
   */
  async getStats(): Promise<{
    totalActive: number;
    totalStuck: number;
    totalComplete: number;
    byRepo: Record<
      string,
      { active: number; stuck: number; complete: number }
    >;
  }> {
    const allSessions = await this.listAllSessions({ includeCompleted: true });
    const byRepo: Record<
      string,
      { active: number; stuck: number; complete: number }
    > = {};

    let totalActive = 0;
    let totalStuck = 0;
    let totalComplete = 0;

    for (const session of allSessions) {
      if (!byRepo[session.repoId]) {
        byRepo[session.repoId] = { active: 0, stuck: 0, complete: 0 };
      }

      if (session.status === 'stuck') {
        totalStuck++;
        byRepo[session.repoId].stuck++;
      } else if (session.status === 'complete') {
        totalComplete++;
        byRepo[session.repoId].complete++;
      } else if (!['cancelled'].includes(session.status)) {
        totalActive++;
        byRepo[session.repoId].active++;
      }
    }

    return { totalActive, totalStuck, totalComplete, byRepo };
  }

  /**
   * Register callback for session events.
   */
  onSessionEvent(callback: SessionEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Start watching all repos for changes.
   * Workers now update the main session file directly, so SessionWatcher
   * detects all changes (no need for separate WorktreeStateWatcher).
   */
  async startWatching(): Promise<void> {
    for (const [repoId, service] of this.services) {
      try {
        // Watch session files in .sessions directory
        const sessionsDir = service.getSessionsDir();
        const watcher = new SessionWatcher(sessionsDir);

        watcher.on(async (event, session, sessionId) => {
          // Track status changes for hook execution
          const key = `${repoId}:${sessionId}`;
          const prevStatus = this.previousStatus.get(key);

          if (session) {
            const newStatus = session.status;

            // Execute hooks on status transitions
            if (prevStatus !== newStatus) {
              if (newStatus === 'stuck') {
                await this.executeHook('onStuck', repoId, session);
              } else if (newStatus === 'complete') {
                await this.executeHook('onComplete', repoId, session);
              } else if (newStatus === 'shipping' && session.pullRequestUrl) {
                await this.executeHook('onShip', repoId, session);
              }
              this.previousStatus.set(key, newStatus);
            }
          } else if (event === 'remove') {
            this.previousStatus.delete(key);
          }

          // Emit to all registered callbacks
          for (const callback of this.eventCallbacks) {
            try {
              callback(event, repoId, session, sessionId);
            } catch (error) {
              console.error(`Session event callback error for ${repoId}:`, error);
            }
          }
        });

        // Initialize previousStatus for existing sessions
        const sessions = await service.list();
        for (const session of sessions) {
          const key = `${repoId}:${session.id}`;
          this.previousStatus.set(key, session.status);
        }

        watcher.start();
        this.watchers.set(repoId, watcher);
        console.log(`Session watcher started for repo: ${repoId} (${sessions.length} sessions)`);
      } catch (error) {
        console.error(`Failed to start watcher for ${repoId}:`, error);
      }
    }
    console.log(`Real-time session watching started for ${this.watchers.size} repos`);
  }

  /**
   * Stop watching.
   */
  async stopWatching(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      await watcher.stop();
    }
    this.watchers.clear();
    this.previousStatus.clear();
  }

  /**
   * Get the central config.
   */
  getConfig(): CentralConfig {
    return this.config;
  }

  /**
   * Execute a command hook if configured.
   */
  private async executeHook(
    hookName: string,
    repoId: string,
    session: SessionState
  ): Promise<void> {
    try {
      const effectiveConfig = getRepoEffectiveConfig(this.config, repoId);
      const result = await this.hookExecutor.executeByName(
        hookName,
        effectiveConfig.hooks,
        {
          session,
          repoId,
          worktreePath: session.worktreePath,
        }
      );

      if (result) {
        if (result.success) {
          console.log(`Hook ${hookName} executed for ${repoId}/${session.id} (${result.duration}ms)`);
          if (result.output) {
            console.log(`  Output: ${result.output.slice(0, 200)}`);
          }
        } else {
          console.error(`Hook ${hookName} failed for ${repoId}/${session.id}:`, result.error);
        }
      }
    } catch (error) {
      console.error(`Error executing hook ${hookName}:`, error);
    }
  }
}
