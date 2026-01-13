import {
  CentralConfig,
  RepoConfig,
  SessionService,
  SessionState,
  SessionStatus,
  SessionWatcher,
  WorktreeStateWatcher,
  GitUtils,
  getRepoEffectiveConfig,
  ExecutionMode,
  HookExecutor,
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
  private worktreeWatchers: Map<string, WorktreeStateWatcher> = new Map();
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
   */
  async initialize(): Promise<void> {
    await this.initializeServices();
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

    return new SessionService({
      projectName: repoId,
      repoRoot: repoConfig.path,
      githubOwner,
      githubRepo,
      worktreePrefix: repoConfig.worktreePrefix,
      baseBranch: repoConfig.baseBranch,
      cliCommand: effectiveConfig.cliCommand,
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
   * Spawn a new worker.
   */
  async spawn(
    repoId: string,
    issueNumber: number,
    mode: ExecutionMode = 'single'
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

    // Add to worktree watcher for real-time status updates
    const worktreeWatcher = this.worktreeWatchers.get(repoId);
    if (worktreeWatcher) {
      worktreeWatcher.addSession(session.id, session.worktreePath);
    }

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
   * Cancel session.
   */
  async cancel(
    repoId: string,
    sessionId: string,
    keepWorktree?: boolean
  ): Promise<void> {
    const service = this.getService(repoId);

    // Get session before cancelling to get worktree path
    const session = await service.get(sessionId);

    // Remove from worktree watcher
    if (session) {
      const worktreeWatcher = this.worktreeWatchers.get(repoId);
      if (worktreeWatcher) {
        worktreeWatcher.removeSession(sessionId, session.worktreePath);
      }
    }

    return service.cancel(sessionId, { keepWorktree });
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
   */
  async startWatching(): Promise<void> {
    for (const [repoId, service] of this.services) {
      try {
        // Watch session files in .sessions directory
        const sessionsDir = service.getSessionsDir();
        const watcher = new SessionWatcher(sessionsDir);

        watcher.on((event, session, sessionId) => {
          // Emit to all registered callbacks
          for (const callback of this.eventCallbacks) {
            try {
              callback(event, repoId, session, sessionId);
            } catch (error) {
              console.error(`Session event callback error for ${repoId}:`, error);
            }
          }
        });

        watcher.start();
        this.watchers.set(repoId, watcher);
        console.log(`Session watcher started for repo: ${repoId}`);

        // Also watch worktree session-state.json files for worker status updates
        const worktreeWatcher = new WorktreeStateWatcher();

        worktreeWatcher.on(async (event, sessionId, worktreeState) => {
          try {
            // Sync worktree state to main session file
            const session = await service.syncWorktreeState(sessionId, worktreeState);
            if (session) {
              // Emit update event so WebSocket broadcasts it
              for (const callback of this.eventCallbacks) {
                try {
                  callback('update', repoId, session, sessionId);
                } catch (error) {
                  console.error(`Worktree state callback error for ${repoId}:`, error);
                }
              }

              // Execute hooks based on status change
              if (worktreeState.status === 'stuck') {
                await this.executeHook('onStuck', repoId, session);
              } else if (worktreeState.status === 'complete') {
                await this.executeHook('onComplete', repoId, session);
              }
            }
          } catch (error) {
            console.error(`Error syncing worktree state for ${repoId}/${sessionId}:`, error);
          }
        });

        // Add existing sessions to worktree watcher
        const sessions = await service.list();
        for (const session of sessions) {
          if (!['complete', 'cancelled'].includes(session.status)) {
            worktreeWatcher.addSession(session.id, session.worktreePath);
          }
        }

        worktreeWatcher.start();
        this.worktreeWatchers.set(repoId, worktreeWatcher);
        console.log(`Worktree watcher started for repo: ${repoId} (${sessions.length} sessions)`);
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

    for (const watcher of this.worktreeWatchers.values()) {
      await watcher.stop();
    }
    this.worktreeWatchers.clear();
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
