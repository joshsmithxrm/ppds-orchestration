import {
  SessionState,
  RalphConfig,
  getRepoEffectiveConfig,
  CentralConfig,
} from '@ppds-orchestration/core';
import { MultiRepoService } from './multi-repo-service.js';

/**
 * Represents a single Ralph iteration.
 */
export interface RalphIteration {
  iteration: number;
  startedAt: string;
  endedAt?: string;
  exitType: 'clean' | 'abnormal' | 'running';
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
  currentIteration: number;
  state: 'running' | 'waiting' | 'done' | 'stuck' | 'paused';
  iterations: RalphIteration[];
  consecutiveFailures: number;
  lastChecked?: string;
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
   */
  async startLoop(repoId: string, sessionId: string): Promise<RalphLoopState> {
    const key = this.getKey(repoId, sessionId);

    if (this.loops.has(key)) {
      return this.loops.get(key)!;
    }

    const effectiveConfig = getRepoEffectiveConfig(this.centralConfig, repoId);
    const state: RalphLoopState = {
      repoId,
      sessionId,
      config: effectiveConfig.ralph,
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

        // Check if done signal detected
        if (await this.checkDoneSignal(state, session)) {
          this.handleLoopDone(state, 'done_signal');
          continue;
        }

        // Check if session is complete or stuck
        if (session.status === 'complete') {
          // Worker marked itself complete - check if really done
          if (await this.checkDoneSignal(state, session)) {
            this.handleLoopDone(state, 'status_complete');
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
        // Would check if file exists in worktree
        // For now, just return false
        return false;

      case 'exit_code':
        // Exit code checking requires process tracking
        return false;

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

    this.emit('iteration_end', state);

    // Check max iterations
    if (state.currentIteration >= state.config.maxIterations) {
      this.handleLoopStuck(state, `Max iterations (${state.config.maxIterations}) reached`);
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
  private handleLoopDone(state: RalphLoopState, reason: string): void {
    const currentIteration = state.iterations[state.iterations.length - 1];
    currentIteration.endedAt = new Date().toISOString();
    currentIteration.doneSignalDetected = true;

    state.state = 'done';
    this.emit('loop_done', state);
    this.stopLoop(state.repoId, state.sessionId);

    console.log(`Ralph loop completed for ${state.repoId}/${state.sessionId}: ${reason}`);
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
   * Get unique key for a loop.
   */
  private getKey(repoId: string, sessionId: string): string {
    return `${repoId}:${sessionId}`;
  }
}
