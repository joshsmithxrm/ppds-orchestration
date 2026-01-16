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
  parsePlanFile,
  invokeReviewAgent,
  notifyReviewStuck,
  notifyPRReady,
  createPullRequest,
  generatePRBody,
  ReviewVerdict,
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
 * Status of the last git commit operation.
 */
export interface GitCommitStatus {
  status: 'success' | 'no_changes' | 'failed';
  message?: string;
  iteration?: number;
}

/**
 * Status of the last git push operation.
 */
export interface GitPushStatus {
  status: 'success' | 'failed';
  message?: string;
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
  state: 'running' | 'waiting' | 'done' | 'stuck' | 'paused' | 'reviewing';
  iterations: RalphIteration[];
  consecutiveFailures: number;
  lastChecked?: string;
  /** Status of the last git commit operation */
  lastCommit?: GitCommitStatus;
  /** Status of the last git push operation */
  lastPush?: GitPushStatus;
  /** Current code review cycle (0 = not yet reviewed, increments on NEEDS_WORK) */
  reviewCycle: number;
  /** Last review verdict received */
  lastReviewVerdict?: ReviewVerdict;
  /** Number of completed tasks at start of current iteration (for progress detection) */
  lastCompletedTaskCount?: number;
  /** Number of failed iterations (no progress made) - counts against maxIterations */
  failedIterations?: number;
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
      reviewCycle: 0,
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
   * Primary detection: worker stopped (via /exit or process exit)
   * Fallback: session status changes
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

        // Check if worker process has exited (headless mode exits when done)
        const workerStatus = await this.getWorkerStatus(state, session);
        if (!workerStatus.running) {
          console.log(`Ralph: Worker process exited for ${state.repoId}/${state.sessionId} (code: ${workerStatus.exitCode})`);
          await this.handleWorkerStopped(state, session);
          continue;
        }

        // FALLBACK: Check if done signal file was created
        if (await this.checkDoneSignal(state, session)) {
          await this.handleLoopDone(state, 'done_signal', session.worktreePath);
          continue;
        }

        // FALLBACK: Check session status for stuck/cancelled
        if (session.status === 'stuck') {
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
   * Get the number of completed tasks from the plan file.
   */
  private getCompletedTaskCount(state: RalphLoopState, worktreePath: string): number {
    const { promise } = state.config;
    if (promise.type !== 'plan_complete') return 0;

    const planPath = path.join(worktreePath, promise.value);
    try {
      if (!fs.existsSync(planPath)) return 0;
      const content = fs.readFileSync(planPath, 'utf-8');
      const { summary } = parsePlanFile(content);
      return summary.complete;
    } catch {
      return 0;
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

    // Update completed task count for next iteration's progress detection
    state.lastCompletedTaskCount = this.getCompletedTaskCount(state, session.worktreePath);

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

    // Restart the worker for this iteration
    try {
      await this.multiRepoService.restart(
        state.repoId,
        state.sessionId,
        state.currentIteration
      );
      this.emit('iteration_start', state);
      console.log(`Ralph: Started iteration ${state.currentIteration} for ${state.repoId}/${state.sessionId}`);
    } catch (error) {
      console.error('Failed to restart worker:', error);
      this.handleLoopStuck(state, `Failed to restart: ${(error as Error).message}`);
    }
  }

  /**
   * Handle worker stopped event.
   * Called when poll detects worker is no longer running.
   * Reads .claude/.worker-status to determine next action.
   */
  private async handleWorkerStopped(
    state: RalphLoopState,
    session: SessionState
  ): Promise<void> {
    // Read worker status signal
    const statusFile = path.join(session.worktreePath, '.claude', '.worker-status');
    let signal = '';

    try {
      if (fs.existsSync(statusFile)) {
        signal = fs.readFileSync(statusFile, 'utf-8').trim();
        // Clear the file for next iteration
        fs.unlinkSync(statusFile);
      }
    } catch {
      // Ignore file read errors
    }

    // Mark current iteration as ended
    const currentIteration = state.iterations[state.iterations.length - 1];
    if (currentIteration) {
      currentIteration.endedAt = new Date().toISOString();
      currentIteration.exitType = signal ? 'clean' : 'abnormal';
      currentIteration.statusAtEnd = session.status;
    }

    // Handle "complete" signal - all tasks done
    if (signal === 'complete') {
      console.log(`Ralph: Worker signaled complete for ${state.repoId}/${state.sessionId}, entering review`);
      await this.performGitOperations(state, session.worktreePath);
      await this.handlePromiseMet(state, session.worktreePath);
      return;
    }

    // Handle "task_done" signal - respawn for next task
    if (signal === 'task_done') {
      console.log(`Ralph: Worker signaled task_done for ${state.repoId}/${state.sessionId}, respawning`);
      await this.performGitOperations(state, session.worktreePath);
      this.emit('iteration_end', state);

      // Wait and spawn next iteration
      state.state = 'waiting';
      setTimeout(() => {
        this.startNextIteration(state);
      }, state.config.iterationDelayMs);
      return;
    }

    // No signal = worker crashed or didn't complete properly
    state.failedIterations = (state.failedIterations ?? 0) + 1;
    console.log(`Ralph: No signal from worker ${state.repoId}/${state.sessionId}, failure ${state.failedIterations}/${state.config.maxIterations}`);

    if (state.failedIterations >= state.config.maxIterations) {
      this.handleLoopStuck(state, `Max failed iterations (${state.config.maxIterations}) reached without signal`);
      return;
    }

    // Respawn to try again
    state.state = 'waiting';
    setTimeout(() => {
      this.startNextIteration(state);
    }, state.config.iterationDelayMs);
  }

  /**
   * Get worker status from spawner via MultiRepoService.
   */
  private async getWorkerStatus(
    state: RalphLoopState,
    session: SessionState
  ): Promise<{ running: boolean; exitCode?: number }> {
    if (!session.spawnId) {
      // No spawnId means worker was never spawned or is legacy
      return { running: false };
    }

    try {
      return await this.multiRepoService.getWorkerStatus(state.repoId, session.spawnId);
    } catch (error) {
      console.warn(`Failed to get worker status: ${(error as Error).message}`);
      return { running: false };
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
   * Triggers the code review phase before PR creation.
   */
  private async handlePromiseMet(state: RalphLoopState, worktreePath: string): Promise<void> {
    const currentIteration = state.iterations[state.iterations.length - 1];
    currentIteration.endedAt = new Date().toISOString();
    currentIteration.exitType = 'promise_met';
    currentIteration.doneSignalDetected = true;

    // Commit and push before review
    await this.performGitOperations(state, worktreePath);

    // Enter review phase
    await this.handleReviewPhase(state, worktreePath);
  }

  /**
   * Handle the code review phase.
   * Invokes the review agent and handles APPROVED/NEEDS_WORK verdicts.
   */
  private async handleReviewPhase(state: RalphLoopState, worktreePath: string): Promise<void> {
    const maxCycles = state.config.reviewConfig?.maxCycles ?? 3;
    state.state = 'reviewing';

    // Get GitHub info from repo config
    const repoConfig = this.centralConfig.repos[state.repoId];
    if (!repoConfig) {
      this.handleLoopStuck(state, 'Repository config not found');
      return;
    }

    // Try to get github owner/repo from config or detect from git
    let githubOwner = repoConfig.githubOwner;
    let githubRepo = repoConfig.githubRepo;

    if (!githubOwner || !githubRepo) {
      // Try to parse from git remote
      try {
        const { stdout } = await execAsync('git config --get remote.origin.url', { cwd: worktreePath });
        const match = stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (match) {
          githubOwner = githubOwner ?? match[1];
          githubRepo = githubRepo ?? match[2];
        }
      } catch {
        // Ignore detection errors
      }
    }

    if (!githubOwner || !githubRepo) {
      console.warn('Ralph: GitHub owner/repo not configured, skipping review phase');
      await this.handleReviewApproved(state, worktreePath, githubOwner, githubRepo);
      return;
    }

    const issueNumber = parseInt(state.sessionId, 10);

    console.log(`Ralph: Starting code review for ${state.repoId}/${state.sessionId} (cycle ${state.reviewCycle + 1}/${maxCycles})`);

    // Invoke the review agent
    const result = await invokeReviewAgent({
      worktreePath,
      githubOwner,
      githubRepo,
      issueNumber,
      agentPromptPath: state.config.reviewConfig?.agentPromptPath,
      timeoutMs: state.config.reviewConfig?.timeoutMs,
    });

    if (!result.success || !result.verdict) {
      // Review failed - treat as NEEDS_WORK
      console.warn(`Ralph: Review agent failed: ${result.error}`);
      state.reviewCycle++;
      state.lastReviewVerdict = {
        status: 'NEEDS_WORK',
        summary: result.error ?? 'Review agent failed',
        feedback: result.error,
      };

      if (state.reviewCycle >= maxCycles) {
        await this.handleReviewStuck(state, worktreePath, githubOwner, githubRepo, issueNumber);
      } else {
        await this.handleNeedsWork(state, worktreePath);
      }
      return;
    }

    state.lastReviewVerdict = result.verdict;

    if (result.verdict.status === 'APPROVED') {
      console.log(`Ralph: Code review APPROVED for ${state.repoId}/${state.sessionId}`);
      await this.handleReviewApproved(state, worktreePath, githubOwner, githubRepo);
    } else {
      // NEEDS_WORK
      state.reviewCycle++;
      console.log(`Ralph: Code review NEEDS_WORK for ${state.repoId}/${state.sessionId} (cycle ${state.reviewCycle}/${maxCycles})`);

      if (state.reviewCycle >= maxCycles) {
        await this.handleReviewStuck(state, worktreePath, githubOwner, githubRepo, issueNumber);
      } else {
        await this.handleNeedsWork(state, worktreePath);
      }
    }
  }

  /**
   * Handle APPROVED verdict - create PR and notify.
   */
  private async handleReviewApproved(
    state: RalphLoopState,
    worktreePath: string,
    githubOwner?: string,
    githubRepo?: string
  ): Promise<void> {
    const issueNumber = parseInt(state.sessionId, 10);

    // Get session to access issue info
    const session = await this.multiRepoService.getSession(state.repoId, state.sessionId);

    // Create PR if configured
    if (state.config.gitOperations.createPrOnComplete && githubOwner && githubRepo) {
      try {
        const prBody = generatePRBody({
          issueNumber,
          issueTitle: session?.issue.title ?? `Issue #${issueNumber}`,
          summary: state.lastReviewVerdict?.summary,
        });

        const prTitle = session?.issue.title
          ? `feat: ${session.issue.title}`
          : `feat: implement issue #${issueNumber}`;

        const prResult = await createPullRequest({
          cwd: worktreePath,
          githubOwner,
          githubRepo,
          title: prTitle,
          body: prBody,
        });

        if (prResult.success && prResult.url) {
          console.log(`Ralph: Created PR ${prResult.url} for ${state.repoId}/${state.sessionId}`);

          // Notify that PR is ready
          await notifyPRReady({
            githubOwner,
            githubRepo,
            issueNumber,
            cwd: worktreePath,
            prUrl: prResult.url,
            prNumber: prResult.number ?? 0,
            summary: state.lastReviewVerdict?.summary,
          });
        } else {
          console.warn(`Ralph: PR creation failed: ${prResult.error}`);
        }
      } catch (error) {
        console.warn(`Ralph: PR creation failed for ${state.repoId}/${state.sessionId}:`, (error as Error).message);
      }
    }

    // Mark loop as done
    state.state = 'done';
    this.emit('loop_done', state);
    this.stopLoop(state.repoId, state.sessionId);

    console.log(`Ralph loop completed for ${state.repoId}/${state.sessionId}: review_approved`);
  }

  /**
   * Handle NEEDS_WORK verdict - respawn worker with feedback.
   */
  private async handleNeedsWork(state: RalphLoopState, worktreePath: string): Promise<void> {
    // Format feedback for the worker
    const feedback = state.lastReviewVerdict?.feedback ?? state.lastReviewVerdict?.summary ?? 'Code review requested changes';

    console.log(`Ralph: Respawning worker with review feedback (cycle ${state.reviewCycle})`);

    // Update session with forwarded message containing review feedback
    try {
      const session = await this.multiRepoService.getSession(state.repoId, state.sessionId);
      if (session) {
        // Write feedback to a file in the worktree that the worker can read
        const feedbackPath = path.join(worktreePath, '.claude', 'review-feedback.md');
        const feedbackContent = [
          '# Code Review Feedback',
          '',
          `**Review Cycle:** ${state.reviewCycle}`,
          '',
          '## Summary',
          state.lastReviewVerdict?.summary ?? 'N/A',
          '',
          '## Required Changes',
          feedback,
          '',
          state.lastReviewVerdict?.issues?.length
            ? '## Issues\n' + state.lastReviewVerdict.issues.map(i => `- [${i.severity}] ${i.description}`).join('\n')
            : '',
        ].join('\n');

        await fs.promises.writeFile(feedbackPath, feedbackContent, 'utf-8');
      }
    } catch (error) {
      console.warn('Ralph: Failed to write review feedback:', (error as Error).message);
    }

    // Start next iteration to address review feedback
    state.state = 'waiting';
    setTimeout(() => {
      this.startNextIteration(state);
    }, state.config.iterationDelayMs);
  }

  /**
   * Handle review stuck - notify and stop loop.
   */
  private async handleReviewStuck(
    state: RalphLoopState,
    worktreePath: string,
    githubOwner: string,
    githubRepo: string,
    issueNumber: number
  ): Promise<void> {
    console.log(`Ralph: Review stuck for ${state.repoId}/${state.sessionId} after ${state.reviewCycle} cycles`);

    // Notify stakeholders
    try {
      await notifyReviewStuck({
        githubOwner,
        githubRepo,
        issueNumber,
        cwd: worktreePath,
        reviewCycle: state.reviewCycle,
        lastFeedback: state.lastReviewVerdict?.feedback ?? state.lastReviewVerdict?.summary,
      });
    } catch (error) {
      console.warn('Ralph: Failed to send review stuck notification:', (error as Error).message);
    }

    // Mark loop as stuck
    this.handleLoopStuck(state, `Code review failed after ${state.reviewCycle} cycles`);
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
          state.lastCommit = {
            status: 'success',
            message: `Committed iteration ${state.currentIteration}`,
            iteration: state.currentIteration,
          };
        } else {
          console.log(`Ralph: No changes to commit for iteration ${state.currentIteration}`);
          state.lastCommit = {
            status: 'no_changes',
            message: 'No changes to commit',
            iteration: state.currentIteration,
          };
        }
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.warn(
          `Ralph: Git commit failed for ${state.repoId}/${state.sessionId}:`,
          errorMessage
        );
        state.lastCommit = {
          status: 'failed',
          message: errorMessage,
          iteration: state.currentIteration,
        };
      }
    }

    // Push changes if configured
    if (gitOperations.pushAfterEach) {
      try {
        await execAsync('git push', { cwd: worktreePath });
        console.log(`Ralph: Pushed changes for iteration ${state.currentIteration}`);
        state.lastPush = {
          status: 'success',
          message: 'Pushed successfully',
        };
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.warn(
          `Ralph: Git push failed for ${state.repoId}/${state.sessionId}:`,
          errorMessage
        );
        state.lastPush = {
          status: 'failed',
          message: errorMessage,
        };
      }
    }
  }

  /**
   * Perform final git operations when loop completes.
   * Note: PR creation is now handled in handleReviewApproved after code review.
   * This method is kept for handleLoopDone which bypasses review (e.g., done signal).
   * @param state The current loop state
   * @param worktreePath Path to the git worktree
   */
  private async performFinalGitOperations(
    state: RalphLoopState,
    worktreePath: string
  ): Promise<void> {
    // Commit and push any remaining changes
    await this.performGitOperations(state, worktreePath);

    // Note: PR creation is now handled in handleReviewPhase/handleReviewApproved
    // For backwards compatibility with done signal exits, we skip PR here
    // since those should go through the review phase first
  }

  /**
   * Get unique key for a loop.
   */
  private getKey(repoId: string, sessionId: string): string {
    return `${repoId}:${sessionId}`;
  }
}
