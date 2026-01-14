import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  SessionState,
  RalphConfig,
  getRepoEffectiveConfig,
  CentralConfig,
  isPromiseMet,
} from '@ppds-orchestration/core';

const execAsync = promisify(exec);
import { MultiRepoService } from './multi-repo-service.js';

/**
 * Represents a single Ralph iteration.
 */
export interface RalphIteration {
  iteration: number;
  startedAt: string;
  endedAt?: string;
  exitType: 'clean' | 'abnormal' | 'running' | 'promise_met';
  doneSignalDetected: boolean;
  statusAtEnd?: string;
}

/**
 * State of a Ralph loop for a specific session.
 */
export interface RalphLoopState {
  repoId: string;
  sessionId: string;
  config: RalphConfig;
  /** Target number of iterations for this loop (from spawn-time options or config default) */
  targetIterations: number;
  currentIteration: number;
  state: 'running' | 'waiting' | 'done' | 'stuck' | 'paused';
  iterations: RalphIteration[];
  consecutiveFailures: number;
  lastChecked?: string;
}

/**
 * Options for starting a Ralph loop.
 */
export interface RalphLoopOptions {
  /** Number of iterations to run (defaults to config.defaultIterations) */
  iterations?: number;
}

type RalphEventCallback = (
  event: 'iteration_start' | 'iteration_end' | 'loop_done' | 'loop_stuck',
  state: RalphLoopState
) => void;

/**
 * Manages Ralph loop execution for sessions in ralph mode.
 */
export class RalphLoopManager {
  private loops: Map<string, RalphLoopState> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private multiRepoService: MultiRepoService;
  private centralConfig: CentralConfig;
  private eventCallbacks: RalphEventCallback[] = [];
  private readonly POLL_INTERVAL_MS = 5000;

  constructor(multiRepoService: MultiRepoService, centralConfig: CentralConfig) {
    this.multiRepoService = multiRepoService;
    this.centralConfig = centralConfig;
  }

  /**
   * Start monitoring a session for Ralph loop.
   * @param repoId Repository identifier
   * @param sessionId Session identifier
   * @param options Optional loop configuration (iterations count, etc.)
   */
  async startLoop(repoId: string, sessionId: string, options?: RalphLoopOptions): Promise<RalphLoopState> {
    const key = this.getKey(repoId, sessionId);

    if (this.loops.has(key)) {
      return this.loops.get(key)!;
    }

    const effectiveConfig = getRepoEffectiveConfig(this.centralConfig, repoId);
    const targetIterations = options?.iterations ?? effectiveConfig.ralph.maxIterations;

    const state: RalphLoopState = {
      repoId,
      sessionId,
      config: effectiveConfig.ralph,
      targetIterations,
      currentIteration: 1,
      state: 'running',
      iterations: [{
        iteration: 1,
        startedAt: new Date().toISOString(),
        exitType: 'running',
        doneSignalDetected: false,
      }],
      consecutiveFailures: 0,
    };

    this.loops.set(key, state);
    this.startPolling();

    this.emit('iteration_start', state);
    return state;
  }

  /**
   * Stop monitoring a session.
   */
  stopLoop(repoId: string, sessionId: string): void {
    const key = this.getKey(repoId, sessionId);
    this.loops.delete(key);

    if (this.loops.size === 0 && this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Get loop state for a session.
   */
  getLoopState(repoId: string, sessionId: string): RalphLoopState | null {
    return this.loops.get(this.getKey(repoId, sessionId)) ?? null;
  }

  /**
   * Get all active loops.
   */
  getActiveLoops(): RalphLoopState[] {
    return Array.from(this.loops.values());
  }

  /**
   * Manually continue to next iteration.
   */
  async continueLoop(repoId: string, sessionId: string): Promise<void> {
    const state = this.getLoopState(repoId, sessionId);
    if (!state || state.state !== 'waiting') {
      throw new Error('Loop not in waiting state');
    }

    await this.startNextIteration(state);
  }

  /**
   * Register event callback.
   */
  onEvent(callback: RalphEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Start the polling loop.
   */
  private startPolling(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      this.poll();
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Poll all active loops for status changes.
   */
  private async poll(): Promise<void> {
    for (const [key, state] of this.loops) {
      if (state.state !== 'running') continue;

      try {
        const session = await this.multiRepoService.getSession(
          state.repoId,
          state.sessionId
        );

        if (!session) {
          // Session was deleted
          this.handleLoopStuck(state, 'Session no longer exists');
          continue;
        }

        state.lastChecked = new Date().toISOString();

        // Check if promise is met (early exit)
        if (await this.checkPromise(state, session)) {
          await this.handlePromiseMet(state, session.worktreePath);
          continue;
        }

        // Check if done signal detected
        if (await this.checkDoneSignal(state, session)) {
          await this.handleLoopDone(state, 'done_signal', session.worktreePath);
          continue;
        }

        // Check if session is complete or stuck
        if (session.status === 'complete') {
          // Worker marked itself complete - check if really done
          if (await this.checkDoneSignal(state, session)) {
            await this.handleLoopDone(state, 'status_complete', session.worktreePath);
          } else {
            // Not done, start next iteration
            await this.handleIterationComplete(state, session);
          }
        } else if (session.status === 'stuck') {
          this.handleLoopStuck(state, session.stuckReason ?? 'Worker got stuck');
        } else if (session.status === 'cancelled') {
          this.stopLoop(state.repoId, state.sessionId);
        }

      } catch (error) {
        console.error(`Error polling loop ${key}:`, error);
      }
    }
  }

  /**
   * Check if the done signal is detected.
   */
  private async checkDoneSignal(
    state: RalphLoopState,
    session: SessionState
  ): Promise<boolean> {
    const { doneSignal } = state.config;

    switch (doneSignal.type) {
      case 'status':
        return session.status === doneSignal.value;

      case 'file':
        // Check if file exists in worktree
        const filePath = path.join(session.worktreePath, doneSignal.value);
        try {
          return fs.existsSync(filePath);
        } catch {
          return false;
        }

      case 'exit_code':
        // Exit code checking requires process tracking
        return false;

      default:
        return false;
    }
  }

  /**
   * Check if the promise condition is met.
   * Promise types:
   * - plan_complete: All tasks in plan file are marked done
   * - file: Specific file exists at path
   * - tests_pass: Test command exits successfully
   * - custom: Custom shell command returns success
   */
  private async checkPromise(
    state: RalphLoopState,
    session: SessionState
  ): Promise<boolean> {
    const { promise } = state.config;

    switch (promise.type) {
      case 'plan_complete': {
        const planPath = path.join(session.worktreePath, promise.value);
        try {
          if (!fs.existsSync(planPath)) {
            return false;
          }
          const content = fs.readFileSync(planPath, 'utf-8');
          return isPromiseMet(content);
        } catch {
          return false;
        }
      }

      case 'file': {
        const filePath = path.join(session.worktreePath, promise.value);
        try {
          return fs.existsSync(filePath);
        } catch {
          return false;
        }
      }

      case 'tests_pass': {
        try {
          await execAsync(promise.value, { cwd: session.worktreePath });
          return true;
        } catch {
          return false;
        }
      }

      case 'custom': {
        try {
          await execAsync(promise.value, { cwd: session.worktreePath });
          return true;
        } catch {
          return false;
        }
      }

      default:
        return false;
    }
  }

  /**
   * Handle a completed iteration.
   */
  private async handleIterationComplete(
    state: RalphLoopState,
    session: SessionState
  ): Promise<void> {
    const currentIteration = state.iterations[state.iterations.length - 1];
    currentIteration.endedAt = new Date().toISOString();
    currentIteration.exitType = 'clean';
    currentIteration.statusAtEnd = session.status;

    // Perform git operations (commit/push) after iteration completes
    await this.performGitOperations(state, session.worktreePath);

    this.emit('iteration_end', state);

    // Check if target iterations reached
    if (state.currentIteration >= state.targetIterations) {
      await this.handleLoopDone(state, `Target iterations (${state.targetIterations}) completed`, session.worktreePath);
      return;
    }

    // Wait and start next iteration
    state.state = 'waiting';
    setTimeout(() => {
      this.startNextIteration(state);
    }, state.config.iterationDelayMs);
  }

  /**
   * Start the next iteration.
   */
  private async startNextIteration(state: RalphLoopState): Promise<void> {
    state.currentIteration++;
    state.state = 'running';
    state.consecutiveFailures = 0;

    state.iterations.push({
      iteration: state.currentIteration,
      startedAt: new Date().toISOString(),
      exitType: 'running',
      doneSignalDetected: false,
    });

    // Re-spawn the worker
    try {
      await this.multiRepoService.spawn(
        state.repoId,
        parseInt(state.sessionId, 10),
        'ralph'
      );
      this.emit('iteration_start', state);
    } catch (error) {
      console.error('Failed to re-spawn worker:', error);
      this.handleLoopStuck(state, `Failed to re-spawn: ${(error as Error).message}`);
    }
  }

  /**
   * Handle loop completion.
   */
  private async handleLoopDone(
    state: RalphLoopState,
    reason: string,
    worktreePath?: string
  ): Promise<void> {
    const currentIteration = state.iterations[state.iterations.length - 1];
    currentIteration.endedAt = new Date().toISOString();
    currentIteration.doneSignalDetected = true;

    // Perform final git operations (PR creation) before stopping
    if (worktreePath) {
      await this.performFinalGitOperations(state, worktreePath);
    }

    state.state = 'done';
    this.emit('loop_done', state);
    this.stopLoop(state.repoId, state.sessionId);

    console.log(`Ralph loop completed for ${state.repoId}/${state.sessionId}: ${reason}`);
  }

  /**
   * Handle promise being met (early successful exit).
   */
  private async handlePromiseMet(state: RalphLoopState, worktreePath: string): Promise<void> {
    const currentIteration = state.iterations[state.iterations.length - 1];
    currentIteration.endedAt = new Date().toISOString();
    currentIteration.exitType = 'promise_met';
    currentIteration.doneSignalDetected = true;

    // Perform final git operations (PR creation) before stopping
    await this.performFinalGitOperations(state, worktreePath);

    state.state = 'done';
    this.emit('loop_done', state);
    this.stopLoop(state.repoId, state.sessionId);

    console.log(`Ralph loop completed for ${state.repoId}/${state.sessionId}: promise_met`);
  }

  /**
   * Handle loop getting stuck.
   */
  private handleLoopStuck(state: RalphLoopState, reason: string): void {
    state.state = 'stuck';
    this.emit('loop_stuck', state);

    console.log(`Ralph loop stuck for ${state.repoId}/${state.sessionId}: ${reason}`);
  }

  /**
   * Emit event to callbacks.
   */
  private emit(
    event: 'iteration_start' | 'iteration_end' | 'loop_done' | 'loop_stuck',
    state: RalphLoopState
  ): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event, state);
      } catch (error) {
        console.error('Error in Ralph event callback:', error);
      }
    }
  }

  /**
   * Perform git operations after an iteration completes.
   * Commits and pushes based on gitOperations config.
   * @param state The current loop state
   * @param worktreePath Path to the git worktree
   */
  private async performGitOperations(
    state: RalphLoopState,
    worktreePath: string
  ): Promise<void> {
    const { gitOperations } = state.config;

    // Commit changes if configured
    if (gitOperations.commitAfterEach) {
      try {
        // Stage all changes
        await execAsync('git add -A', { cwd: worktreePath });

        // Check if there are staged changes
        const { stdout: statusOutput } = await execAsync(
          'git diff --cached --quiet || echo "changes"',
          { cwd: worktreePath }
        );

        if (statusOutput.trim() === 'changes') {
          const commitMessage = `chore: ralph iteration ${state.currentIteration}`;
          await execAsync(`git commit -m "${commitMessage}"`, { cwd: worktreePath });
          console.log(`Ralph: Committed changes for iteration ${state.currentIteration}`);
        } else {
          console.log(`Ralph: No changes to commit for iteration ${state.currentIteration}`);
        }
      } catch (error) {
        console.warn(
          `Ralph: Git commit failed for ${state.repoId}/${state.sessionId}:`,
          (error as Error).message
        );
      }
    }

    // Push changes if configured
    if (gitOperations.pushAfterEach) {
      try {
        await execAsync('git push', { cwd: worktreePath });
        console.log(`Ralph: Pushed changes for iteration ${state.currentIteration}`);
      } catch (error) {
        console.warn(
          `Ralph: Git push failed for ${state.repoId}/${state.sessionId}:`,
          (error as Error).message
        );
      }
    }
  }

  /**
   * Perform final git operations when loop completes.
   * Creates a PR if configured.
   * @param state The current loop state
   * @param worktreePath Path to the git worktree
   */
  private async performFinalGitOperations(
    state: RalphLoopState,
    worktreePath: string
  ): Promise<void> {
    const { gitOperations } = state.config;

    if (!gitOperations.createPrOnComplete) {
      return;
    }

    try {
      // Get the current branch name
      const { stdout: branchName } = await execAsync(
        'git rev-parse --abbrev-ref HEAD',
        { cwd: worktreePath }
      );
      const branch = branchName.trim();

      // Don't create PR if on main/master
      if (branch === 'main' || branch === 'master') {
        console.log('Ralph: Skipping PR creation - on main/master branch');
        return;
      }

      // Generate PR title and body
      const prTitle = `Ralph: ${state.repoId}/${state.sessionId} completed`;
      const prBody = [
        '## Ralph Loop Summary',
        '',
        `- **Repository:** ${state.repoId}`,
        `- **Session:** ${state.sessionId}`,
        `- **Iterations completed:** ${state.currentIteration}`,
        `- **Target iterations:** ${state.targetIterations}`,
        '',
        '_This PR was automatically created by Ralph loop manager._',
      ].join('\n');

      // Create the PR using gh CLI
      await execAsync(
        `gh pr create --title "${prTitle}" --body "${prBody.replace(/"/g, '\\"')}"`,
        { cwd: worktreePath }
      );
      console.log(`Ralph: Created PR for ${state.repoId}/${state.sessionId}`);
    } catch (error) {
      console.warn(
        `Ralph: PR creation failed for ${state.repoId}/${state.sessionId}:`,
        (error as Error).message
      );
    }
  }

  /**
   * Get unique key for a loop.
   */
  private getKey(repoId: string, sessionId: string): string {
    return `${repoId}:${sessionId}`;
  }
}
