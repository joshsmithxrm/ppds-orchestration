import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsActual from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CentralConfig, RalphConfig, SessionState } from '@ppds-orchestration/core';

// Mock the review/notification functions from core
vi.mock('@ppds-orchestration/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ppds-orchestration/core')>();
  return {
    ...actual,
    // Default to APPROVED so tests that don't explicitly test review behavior pass
    invokeReviewAgent: vi.fn().mockResolvedValue({
      success: true,
      verdict: { status: 'APPROVED', summary: 'Auto-approved for test' },
      durationMs: 100,
    }),
    notifyReviewStuck: vi.fn().mockResolvedValue({ success: true }),
    notifyPRReady: vi.fn().mockResolvedValue({ success: true }),
    createPullRequest: vi.fn().mockResolvedValue({
      success: true,
      url: 'https://github.com/test/test/pull/1',
      number: 1,
    }),
    generatePRBody: vi.fn(() => 'Generated PR body'),
  };
});

import {
  invokeReviewAgent,
  notifyReviewStuck,
  notifyPRReady,
  createPullRequest,
} from '@ppds-orchestration/core';

import { RalphLoopManager, RalphLoopState } from './ralph-loop-manager.js';
import { MultiRepoService } from './multi-repo-service.js';

describe('RalphLoopManager', () => {
  let manager: RalphLoopManager;
  let mockMultiRepoService: Partial<MultiRepoService>;
  let mockCentralConfig: CentralConfig;
  let tempDir: string;

  const createMockSession = (overrides: Partial<SessionState> = {}): SessionState => ({
    id: '1',
    issue: { number: 1, title: 'Test Issue', body: 'Test body' },
    status: 'working',
    mode: 'autonomous',
    branch: 'issue-1',
    worktreePath: tempDir,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    ...overrides,
  });

  const createRalphConfig = (overrides: Partial<RalphConfig> = {}): RalphConfig => ({
    maxIterations: 10,
    promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
    gitOperations: {
      commitAfterEach: true,
      pushAfterEach: true,
      createPrOnComplete: true,
    },
    doneSignal: { type: 'file', value: '.claude/.ralph-done' },
    iterationDelayMs: 5000,
    spawner: { type: 'windows-terminal', usePty: false, docker: { image: 'ppds-worker:latest', memoryLimit: '4g', cpuLimit: '2', volumes: [], env: {} } },
    reviewConfig: { maxCycles: 3, timeoutMs: 300_000 },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a real temp directory for testing
    tempDir = fsActual.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));

    mockMultiRepoService = {
      getSession: vi.fn(),
      spawn: vi.fn(),
      getWorkerStatus: vi.fn().mockResolvedValue({ running: true }), // Default: worker running
      stopWorker: vi.fn().mockResolvedValue(undefined), // Stop worker mock
    };

    mockCentralConfig = {
      version: '1.0',
      repos: {
        'test-repo': {
          path: tempDir,
          githubOwner: 'test-owner',
          githubRepo: 'test-repo',
        },
      },
      ralph: createRalphConfig(),
      cliCommand: 'orch',
    };

    manager = new RalphLoopManager(
      mockMultiRepoService as MultiRepoService,
      mockCentralConfig
    );
  });

  afterEach(() => {
    // Stop any loops to clean up intervals
    manager.stopLoop('test-repo', '1');

    // Clean up temp directory
    fsActual.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('startLoop', () => {
    it('should create a new loop state with correct initial values', async () => {
      const state = await manager.startLoop('test-repo', '1');

      expect(state.repoId).toBe('test-repo');
      expect(state.sessionId).toBe('1');
      expect(state.currentIteration).toBe(1);
      expect(state.state).toBe('running');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.iterations).toHaveLength(1);
      expect(state.iterations[0].iteration).toBe(1);
      expect(state.iterations[0].exitType).toBe('running');
    });

    it('should use custom iterations count when provided', async () => {
      const state = await manager.startLoop('test-repo', '1', { iterations: 5 });

      expect(state.targetIterations).toBe(5);
    });

    it('should return existing loop state if already started', async () => {
      const first = await manager.startLoop('test-repo', '1');
      const second = await manager.startLoop('test-repo', '1');

      expect(first).toBe(second);
    });

    it('should use maxIterations from config when iterations not specified', async () => {
      const state = await manager.startLoop('test-repo', '1');

      expect(state.targetIterations).toBe(10); // from createRalphConfig default
    });
  });

  describe('stopLoop', () => {
    it('should remove loop from active loops', async () => {
      await manager.startLoop('test-repo', '1');

      expect(manager.getLoopState('test-repo', '1')).not.toBeNull();

      manager.stopLoop('test-repo', '1');

      expect(manager.getLoopState('test-repo', '1')).toBeNull();
    });
  });

  describe('getActiveLoops', () => {
    it('should return all active loops', async () => {
      // Add repo-2 to config for this test
      const configWithMultipleRepos: CentralConfig = {
        ...mockCentralConfig,
        repos: {
          'test-repo': mockCentralConfig.repos['test-repo'],
          'test-repo-2': {
            path: tempDir,
            githubOwner: 'test-owner',
            githubRepo: 'test-repo-2',
          },
        },
      };

      const multiRepoManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithMultipleRepos
      );

      await multiRepoManager.startLoop('test-repo', '1');
      await multiRepoManager.startLoop('test-repo-2', '2');

      const loops = multiRepoManager.getActiveLoops();

      expect(loops).toHaveLength(2);
      expect(loops.map(l => l.repoId)).toContain('test-repo');
      expect(loops.map(l => l.repoId)).toContain('test-repo-2');

      // Cleanup
      multiRepoManager.stopLoop('test-repo', '1');
      multiRepoManager.stopLoop('test-repo-2', '2');
    });

    it('should return empty array when no loops active', () => {
      const loops = manager.getActiveLoops();
      expect(loops).toEqual([]);
    });
  });

  describe('getLoopState', () => {
    it('should return null for non-existent loop', () => {
      const state = manager.getLoopState('non-existent', '1');
      expect(state).toBeNull();
    });

    it('should return loop state for existing loop', async () => {
      await manager.startLoop('test-repo', '1');

      const state = manager.getLoopState('test-repo', '1');

      expect(state).not.toBeNull();
      expect(state?.repoId).toBe('test-repo');
      expect(state?.sessionId).toBe('1');
    });
  });

  describe('Event Callbacks', () => {
    it('should emit iteration_start event when loop starts', async () => {
      const callback = vi.fn();
      manager.onEvent(callback);

      await manager.startLoop('test-repo', '1');

      expect(callback).toHaveBeenCalledWith(
        'iteration_start',
        expect.objectContaining({
          repoId: 'test-repo',
          sessionId: '1',
          currentIteration: 1,
        })
      );
    });

    it('should support multiple event callbacks', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.onEvent(callback1);
      manager.onEvent(callback2);

      await manager.startLoop('test-repo', '1');

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('continueLoop', () => {
    it('should throw if loop is not in waiting state', async () => {
      await manager.startLoop('test-repo', '1');

      await expect(manager.continueLoop('test-repo', '1')).rejects.toThrow(
        'Loop not in waiting state'
      );
    });

    it('should throw if loop does not exist', async () => {
      await expect(manager.continueLoop('non-existent', '1')).rejects.toThrow(
        'Loop not in waiting state'
      );
    });
  });

  describe('RalphLoopState interface', () => {
    it('should have all required fields initialized', async () => {
      const state = await manager.startLoop('test-repo', '1');

      // Verify all interface fields are present
      expect(state).toHaveProperty('repoId');
      expect(state).toHaveProperty('sessionId');
      expect(state).toHaveProperty('config');
      expect(state).toHaveProperty('targetIterations');
      expect(state).toHaveProperty('currentIteration');
      expect(state).toHaveProperty('state');
      expect(state).toHaveProperty('iterations');
      expect(state).toHaveProperty('consecutiveFailures');

      // Optional fields should start as undefined
      expect(state.lastCommit).toBeUndefined();
      expect(state.lastPush).toBeUndefined();
    });

    it('should have valid config with promise and gitOperations', async () => {
      const state = await manager.startLoop('test-repo', '1');

      expect(state.config.promise).toBeDefined();
      expect(state.config.promise.type).toBe('plan_complete');
      expect(state.config.promise.value).toBe('IMPLEMENTATION_PLAN.md');

      expect(state.config.gitOperations).toBeDefined();
      expect(state.config.gitOperations.commitAfterEach).toBe(true);
      expect(state.config.gitOperations.pushAfterEach).toBe(true);
      expect(state.config.gitOperations.createPrOnComplete).toBe(true);
    });
  });

  describe('RalphIteration interface', () => {
    it('should create iteration with correct initial state', async () => {
      const state = await manager.startLoop('test-repo', '1');

      const iteration = state.iterations[0];
      expect(iteration.iteration).toBe(1);
      expect(iteration.exitType).toBe('running');
      expect(iteration.doneSignalDetected).toBe(false);
      expect(iteration.startedAt).toBeDefined();
      expect(iteration.endedAt).toBeUndefined();
      expect(iteration.statusAtEnd).toBeUndefined();
    });
  });

  describe('GitCommitStatus and GitPushStatus interfaces', () => {
    it('GitCommitStatus should support success status', async () => {
      const state = await manager.startLoop('test-repo', '1');

      // Simulate setting lastCommit (normally done by performGitOperations)
      state.lastCommit = {
        status: 'success',
        message: 'Committed iteration 1',
        iteration: 1,
      };

      expect(state.lastCommit.status).toBe('success');
      expect(state.lastCommit.message).toContain('Committed');
      expect(state.lastCommit.iteration).toBe(1);
    });

    it('GitCommitStatus should support no_changes status', async () => {
      const state = await manager.startLoop('test-repo', '1');

      state.lastCommit = {
        status: 'no_changes',
        message: 'No changes to commit',
        iteration: 1,
      };

      expect(state.lastCommit.status).toBe('no_changes');
    });

    it('GitCommitStatus should support failed status', async () => {
      const state = await manager.startLoop('test-repo', '1');

      state.lastCommit = {
        status: 'failed',
        message: 'fatal: not a git repository',
        iteration: 1,
      };

      expect(state.lastCommit.status).toBe('failed');
      expect(state.lastCommit.message).toContain('git repository');
    });

    it('GitPushStatus should support success status', async () => {
      const state = await manager.startLoop('test-repo', '1');

      state.lastPush = {
        status: 'success',
        message: 'Pushed successfully',
      };

      expect(state.lastPush.status).toBe('success');
    });

    it('GitPushStatus should support failed status', async () => {
      const state = await manager.startLoop('test-repo', '1');

      state.lastPush = {
        status: 'failed',
        message: 'rejected: permission denied',
      };

      expect(state.lastPush.status).toBe('failed');
    });
  });

  describe('Promise config types', () => {
    it('should accept plan_complete promise type', async () => {
      const state = await manager.startLoop('test-repo', '1');
      expect(state.config.promise.type).toBe('plan_complete');
    });

    it('should accept file promise type', async () => {
      const configWithFilePromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'file', value: 'dist/output.js' },
        }),
      };

      const fileManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithFilePromise
      );

      const state = await fileManager.startLoop('test-repo', '1');
      expect(state.config.promise.type).toBe('file');
      expect(state.config.promise.value).toBe('dist/output.js');

      fileManager.stopLoop('test-repo', '1');
    });

    it('should accept tests_pass promise type', async () => {
      const configWithTestsPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'tests_pass', value: 'npm test' },
        }),
      };

      const testsManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithTestsPromise
      );

      const state = await testsManager.startLoop('test-repo', '1');
      expect(state.config.promise.type).toBe('tests_pass');
      expect(state.config.promise.value).toBe('npm test');

      testsManager.stopLoop('test-repo', '1');
    });

    it('should accept custom promise type', async () => {
      const configWithCustomPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'custom', value: 'node validate.js' },
        }),
      };

      const customManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithCustomPromise
      );

      const state = await customManager.startLoop('test-repo', '1');
      expect(state.config.promise.type).toBe('custom');
      expect(state.config.promise.value).toBe('node validate.js');

      customManager.stopLoop('test-repo', '1');
    });
  });

  describe('Git operations config', () => {
    it('should respect commitAfterEach setting', async () => {
      const configWithCommitDisabled: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: true,
            createPrOnComplete: true,
          },
        }),
      };

      const noCommitManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithCommitDisabled
      );

      const state = await noCommitManager.startLoop('test-repo', '1');
      expect(state.config.gitOperations.commitAfterEach).toBe(false);
      expect(state.config.gitOperations.pushAfterEach).toBe(true);

      noCommitManager.stopLoop('test-repo', '1');
    });

    it('should respect pushAfterEach setting', async () => {
      const configWithPushDisabled: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          gitOperations: {
            commitAfterEach: true,
            pushAfterEach: false,
            createPrOnComplete: true,
          },
        }),
      };

      const noPushManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithPushDisabled
      );

      const state = await noPushManager.startLoop('test-repo', '1');
      expect(state.config.gitOperations.pushAfterEach).toBe(false);

      noPushManager.stopLoop('test-repo', '1');
    });

    it('should respect createPrOnComplete setting', async () => {
      const configWithPrDisabled: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          gitOperations: {
            commitAfterEach: true,
            pushAfterEach: true,
            createPrOnComplete: false,
          },
        }),
      };

      const noPrManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithPrDisabled
      );

      const state = await noPrManager.startLoop('test-repo', '1');
      expect(state.config.gitOperations.createPrOnComplete).toBe(false);

      noPrManager.stopLoop('test-repo', '1');
    });
  });

  describe('Done signal config', () => {
    it('should accept status type done signal', async () => {
      const configWithStatusSignal: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          doneSignal: { type: 'status', value: 'complete' },
        }),
      };

      const statusManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithStatusSignal
      );

      const state = await statusManager.startLoop('test-repo', '1');
      expect(state.config.doneSignal.type).toBe('status');
      expect(state.config.doneSignal.value).toBe('complete');

      statusManager.stopLoop('test-repo', '1');
    });

    it('should accept file type done signal', async () => {
      const state = await manager.startLoop('test-repo', '1');
      // Default config uses file type
      expect(state.config.doneSignal.type).toBe('file');
      expect(state.config.doneSignal.value).toBe('.claude/.ralph-done');
    });

    it('should accept exit_code type done signal', async () => {
      const configWithExitCodeSignal: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          doneSignal: { type: 'exit_code', value: '0' },
        }),
      };

      const exitCodeManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithExitCodeSignal
      );

      const state = await exitCodeManager.startLoop('test-repo', '1');
      expect(state.config.doneSignal.type).toBe('exit_code');
      expect(state.config.doneSignal.value).toBe('0');

      exitCodeManager.stopLoop('test-repo', '1');
    });
  });

  describe('Loop state transitions', () => {
    it('should initialize in running state', async () => {
      const state = await manager.startLoop('test-repo', '1');
      expect(state.state).toBe('running');
    });

    it('should track state values correctly', async () => {
      const state = await manager.startLoop('test-repo', '1');

      // Valid states: 'running' | 'waiting' | 'done' | 'stuck' | 'paused'
      expect(['running', 'waiting', 'done', 'stuck', 'paused']).toContain(state.state);
    });
  });

  describe('Iteration tracking', () => {
    it('should start with iteration 1', async () => {
      const state = await manager.startLoop('test-repo', '1');
      expect(state.currentIteration).toBe(1);
    });

    it('should have exactly one iteration at start', async () => {
      const state = await manager.startLoop('test-repo', '1');
      expect(state.iterations).toHaveLength(1);
    });

    it('should track iteration timestamps', async () => {
      const beforeStart = new Date().toISOString();
      const state = await manager.startLoop('test-repo', '1');
      const afterStart = new Date().toISOString();

      const startedAt = state.iterations[0].startedAt;
      expect(startedAt >= beforeStart).toBe(true);
      expect(startedAt <= afterStart).toBe(true);
    });
  });

  describe('Consecutive failures tracking', () => {
    it('should start with zero consecutive failures', async () => {
      const state = await manager.startLoop('test-repo', '1');
      expect(state.consecutiveFailures).toBe(0);
    });
  });

  describe('Poll cycle integration', () => {
    let noGitManager: RalphLoopManager;

    beforeEach(() => {
      vi.useFakeTimers();

      // Create a manager with git operations disabled to avoid async exec interference
      const noGitConfig: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };
      noGitManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        noGitConfig
      );
    });

    afterEach(async () => {
      // Stop all loops before restoring timers
      noGitManager.stopLoop('test-repo', '1');
      manager.stopLoop('test-repo', '1');
      vi.useRealTimers();
      // Allow any pending I/O to settle
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('should update lastChecked timestamp on poll', async () => {
      const mockSession = createMockSession({ status: 'working' });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const state = await noGitManager.startLoop('test-repo', '1');
      expect(state.lastChecked).toBeUndefined();

      // Advance timer to trigger poll
      await vi.advanceTimersByTimeAsync(5000);

      expect(state.lastChecked).toBeDefined();
    });

    it('should not poll loops that are not in running state', async () => {
      const mockSession = createMockSession({ status: 'working' });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const state = await noGitManager.startLoop('test-repo', '1');
      state.state = 'paused';

      const initialChecked = state.lastChecked;
      await vi.advanceTimersByTimeAsync(5000);

      // lastChecked should not have changed since loop is paused
      expect(state.lastChecked).toBe(initialChecked);
    });

    it('should trigger iteration_end when worker stops with progress', async () => {
      // With the new worker-stop-triggered design, we need:
      // 1. Worker to stop (running: false)
      // 2. Progress in the plan file (completed tasks > lastCompletedTaskCount)
      const noGitConfig: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          maxIterations: 10,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };
      const testManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        noGitConfig
      );

      // Create plan file with one completed task and one remaining
      // This ensures checkPromise returns false (not all done) so we get iteration_end
      const planContent = `# Implementation Plan
### Task 0: First task
- [x] **Description**: First task done

### Task 1: Second task
- [ ] **Description**: Second task pending
`;
      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);

      // Session with spawnId so we can check worker status
      const mockSession = createMockSession({ status: 'working', spawnId: 'test-spawn-id' });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      // Worker has stopped
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: false });

      const callback = vi.fn();
      testManager.onEvent(callback);

      await testManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // iteration_end should be emitted when worker stops with progress
      expect(callback).toHaveBeenCalledWith(
        'iteration_end',
        expect.objectContaining({
          repoId: 'test-repo',
          sessionId: '1',
        })
      );

      testManager.stopLoop('test-repo', '1');
    });

    it('should handle loop stuck when session is stuck (fallback behavior)', async () => {
      // With worker-stop-triggered design, stuck is a fallback when worker is still running
      const mockSession = createMockSession({
        status: 'stuck',
        stuckReason: 'Test stuck reason',
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      // Worker is STILL running (hasn't exited yet) - so we check fallback status
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: true });

      const callback = vi.fn();
      noGitManager.onEvent(callback);

      const state = await noGitManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledWith('loop_stuck', expect.any(Object));
      expect(state.state).toBe('stuck');
    });

    it('should stop loop when session is cancelled (fallback behavior)', async () => {
      // With worker-stop-triggered design, cancelled is a fallback when worker is still running
      const mockSession = createMockSession({ status: 'cancelled', spawnId: 'test-spawn-id' });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      // Worker is STILL running - so we check fallback status
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: true });

      await noGitManager.startLoop('test-repo', '1');

      await vi.advanceTimersByTimeAsync(5000);

      expect(noGitManager.getLoopState('test-repo', '1')).toBeNull();
    });

    it('should handle loop stuck when session no longer exists', async () => {
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(null);

      const callback = vi.fn();
      noGitManager.onEvent(callback);

      const state = await noGitManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledWith('loop_stuck', expect.any(Object));
      expect(state.state).toBe('stuck');
    });
  });

  describe('checkDoneSignal behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      manager.stopLoop('test-repo', '1');
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('should detect status type done signal when session.status matches value', async () => {
      const configWithStatusSignal: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          doneSignal: { type: 'status', value: 'pr_ready' },
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      const statusManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithStatusSignal
      );

      // Session with spawnId and worker still running so we reach done signal check
      const mockSession = createMockSession({ status: 'pr_ready', spawnId: 'test-spawn-id' });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: true });

      const callback = vi.fn();
      statusManager.onEvent(callback);

      await statusManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));

      statusManager.stopLoop('test-repo', '1');
    });

    it('should detect file type done signal when file exists in worktree', async () => {
      // Create manager with git operations disabled
      const noGitConfig: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };
      const noGitManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        noGitConfig
      );

      // Create the done signal file in the temp directory
      const doneDir = path.join(tempDir, '.claude');
      fsActual.mkdirSync(doneDir, { recursive: true });
      fsActual.writeFileSync(path.join(doneDir, '.ralph-done'), 'done');

      // Session with spawnId and worker still running so we reach done signal check
      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: true });

      const callback = vi.fn();
      noGitManager.onEvent(callback);

      await noGitManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));

      noGitManager.stopLoop('test-repo', '1');
    });

    it('should not detect file type done signal when file does not exist', async () => {
      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      manager.onEvent(callback);

      await manager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // Should not emit loop_done since file doesn't exist
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));
    });

    it('should return false for exit_code type (not implemented)', async () => {
      const configWithExitCodeSignal: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          doneSignal: { type: 'exit_code', value: '0' },
        }),
      };

      const exitCodeManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithExitCodeSignal
      );

      const mockSession = createMockSession({ status: 'working' });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      exitCodeManager.onEvent(callback);

      await exitCodeManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // Should not emit loop_done since exit_code always returns false
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));

      exitCodeManager.stopLoop('test-repo', '1');
    });
  });

  describe('checkPromise behavior with isPromiseMet', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      manager.stopLoop('test-repo', '1');
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('should detect plan_complete promise when all tasks are marked complete', async () => {
      // Create manager with git operations disabled
      const noGitConfig: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };
      const noGitManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        noGitConfig
      );

      // Create a plan file with all tasks complete
      const planContent = `# Implementation Plan

### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done

### Task 1: Feature
- [x] **Description**: Implement feature
- **Phase**: 1
- **Depends-On**: 0
- **Acceptance**: Tests pass
`;

      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      noGitManager.onEvent(callback);

      await noGitManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // loop_done should be called since promise is met
      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));

      // Check the iteration exit type is promise_met
      const state = callback.mock.calls.find(
        (call) => call[0] === 'loop_done'
      )?.[1] as RalphLoopState;
      expect(state?.iterations[0].exitType).toBe('promise_met');

      noGitManager.stopLoop('test-repo', '1');
    });

    it('should not detect plan_complete promise when tasks are incomplete', async () => {
      // Create a plan file with incomplete tasks
      const planContent = `# Implementation Plan

### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done

### Task 1: Feature
- [ ] **Description**: Implement feature
- **Phase**: 1
- **Depends-On**: 0
- **Acceptance**: Tests pass
`;

      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      manager.onEvent(callback);

      await manager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // loop_done should NOT be called since tasks are incomplete
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));
    });

    it('should not detect plan_complete promise when plan file does not exist', async () => {
      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      manager.onEvent(callback);

      await manager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // loop_done should NOT be called since plan file doesn't exist
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));
    });

    it('should detect file type promise when file exists', async () => {
      const configWithFilePromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'file', value: 'dist/output.js' },
          doneSignal: { type: 'exit_code', value: '0' }, // Use exit_code to avoid done signal interference
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      const fileManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithFilePromise
      );

      // Create the promise file
      fsActual.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
      fsActual.writeFileSync(path.join(tempDir, 'dist', 'output.js'), 'module.exports = {}');

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      fileManager.onEvent(callback);

      await fileManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));

      fileManager.stopLoop('test-repo', '1');
    });

    it('should not detect file type promise when file does not exist', async () => {
      const configWithFilePromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'file', value: 'dist/output.js' },
          doneSignal: { type: 'exit_code', value: '0' }, // Use exit_code to avoid done signal interference
        }),
      };

      const fileManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithFilePromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      fileManager.onEvent(callback);

      await fileManager.startLoop('test-repo', '1');
      callback.mockClear();

      await vi.advanceTimersByTimeAsync(5000);

      // loop_done should NOT be called since file doesn't exist
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));

      fileManager.stopLoop('test-repo', '1');
    });
  });

  describe('tests_pass promise type integration', () => {
    // Use real timers for exec-based tests since execAsync needs real time
    let testsManager: RalphLoopManager;

    afterEach(async () => {
      if (testsManager) {
        testsManager.stopLoop('test-repo', '1');
      }
      manager.stopLoop('test-repo', '1');
    });

    it('should return true when test command exits successfully (exit code 0)', async () => {
      // Use node -e to execute a simple exit(0) command that works cross-platform
      const configWithTestsPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'tests_pass', value: 'node -e "process.exit(0)"' },
          doneSignal: { type: 'exit_code', value: '0' }, // Use exit_code to avoid done signal interference
          iterationDelayMs: 100, // Short delay for faster tests
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      testsManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithTestsPromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      testsManager.onEvent(callback);

      await testsManager.startLoop('test-repo', '1');
      callback.mockClear();

      // Wait for the poll cycle to execute and check the promise
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // loop_done should be called since tests passed
      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));

      // Check the iteration exit type is promise_met
      const state = callback.mock.calls.find(
        (call) => call[0] === 'loop_done'
      )?.[1] as RalphLoopState;
      expect(state?.iterations[0].exitType).toBe('promise_met');
    }, 10000);

    it('should return false when test command fails (non-zero exit code)', async () => {
      // Use node -e to execute a simple exit(1) command that fails
      const configWithTestsPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'tests_pass', value: 'node -e "process.exit(1)"' },
          doneSignal: { type: 'exit_code', value: '0' }, // Use exit_code to avoid done signal interference
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      testsManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithTestsPromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      testsManager.onEvent(callback);

      await testsManager.startLoop('test-repo', '1');
      callback.mockClear();

      // Wait for the poll cycle to execute
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // loop_done should NOT be called since tests failed
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));
    }, 10000);

    it('should execute command in session worktreePath', async () => {
      // Create a script in the temp directory that creates a marker file
      const markerFile = path.join(tempDir, 'command-executed.marker');
      const testCommand = `node -e "require('fs').writeFileSync('command-executed.marker', 'executed')"`;

      const configWithTestsPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'tests_pass', value: testCommand },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      testsManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithTestsPromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      await testsManager.startLoop('test-repo', '1');

      // Wait for the poll cycle to execute
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Verify the command was executed in the worktreePath by checking the marker file
      expect(fsActual.existsSync(markerFile)).toBe(true);
      expect(fsActual.readFileSync(markerFile, 'utf-8')).toBe('executed');
    }, 10000);
  });

  describe('custom promise type integration', () => {
    // Use real timers for exec-based tests since execAsync needs real time
    let customManager: RalphLoopManager;

    afterEach(async () => {
      if (customManager) {
        customManager.stopLoop('test-repo', '1');
      }
      manager.stopLoop('test-repo', '1');
    });

    it('should return true when custom command exits successfully', async () => {
      // Use node -e to execute a simple exit(0) command
      const configWithCustomPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'custom', value: 'node -e "process.exit(0)"' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      customManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithCustomPromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      customManager.onEvent(callback);

      await customManager.startLoop('test-repo', '1');
      callback.mockClear();

      // Wait for the poll cycle to execute
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // loop_done should be called since custom command succeeded
      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));

      // Check the iteration exit type is promise_met
      const state = callback.mock.calls.find(
        (call) => call[0] === 'loop_done'
      )?.[1] as RalphLoopState;
      expect(state?.iterations[0].exitType).toBe('promise_met');
    }, 10000);

    it('should return false when custom command fails', async () => {
      // Use node -e to execute a simple exit(1) command that fails
      const configWithCustomPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'custom', value: 'node -e "process.exit(1)"' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      customManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithCustomPromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      const callback = vi.fn();
      customManager.onEvent(callback);

      await customManager.startLoop('test-repo', '1');
      callback.mockClear();

      // Wait for the poll cycle to execute
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // loop_done should NOT be called since custom command failed
      expect(callback).not.toHaveBeenCalledWith('loop_done', expect.any(Object));
    }, 10000);

    it('should execute custom command in session worktreePath', async () => {
      // Create a script that creates a marker file to verify cwd
      const markerFile = path.join(tempDir, 'custom-executed.marker');
      const customCommand = `node -e "require('fs').writeFileSync('custom-executed.marker', 'custom-executed')"`;

      const configWithCustomPromise: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'custom', value: customCommand },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: false,
          },
        }),
      };

      customManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithCustomPromise
      );

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);

      await customManager.startLoop('test-repo', '1');

      // Wait for the poll cycle to execute
      await new Promise((resolve) => setTimeout(resolve, 6000));

      // Verify the command was executed in the worktreePath by checking the marker file
      expect(fsActual.existsSync(markerFile)).toBe(true);
      expect(fsActual.readFileSync(markerFile, 'utf-8')).toBe('custom-executed');
    }, 10000);
  });

  describe('review-cycle', () => {
    let reviewManager: RalphLoopManager;

    beforeEach(() => {
      vi.useFakeTimers();
      // Reset mocks before each test
      vi.mocked(invokeReviewAgent).mockReset();
      vi.mocked(notifyReviewStuck).mockReset();
      vi.mocked(notifyPRReady).mockReset();
      vi.mocked(createPullRequest).mockReset();
    });

    afterEach(async () => {
      if (reviewManager) {
        reviewManager.stopLoop('test-repo', '1');
      }
      manager.stopLoop('test-repo', '1');
      vi.useRealTimers();
    });

    // Helper to set up worker status file with "complete" signal
    const setupWorkerCompleteSignal = () => {
      const claudeDir = path.join(tempDir, '.claude');
      fsActual.mkdirSync(claudeDir, { recursive: true });
      fsActual.writeFileSync(path.join(claudeDir, '.worker-status'), 'complete');
    };

    it('should initialize reviewCycle to 0 when starting a loop', async () => {
      const state = await manager.startLoop('test-repo', '1');
      expect(state.reviewCycle).toBe(0);
    });

    it('should invoke review agent when promise is met', async () => {
      // Mock review agent to return APPROVED
      vi.mocked(invokeReviewAgent).mockResolvedValue({
        success: true,
        verdict: { status: 'APPROVED', summary: 'Code looks good' },
        durationMs: 1000,
      });

      vi.mocked(createPullRequest).mockResolvedValue({
        success: true,
        url: 'https://github.com/test-owner/test-repo/pull/1',
        number: 1,
      });

      vi.mocked(notifyPRReady).mockResolvedValue({ success: true });

      const configWithReview: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: true,
          },
          reviewConfig: { maxCycles: 3, timeoutMs: 300_000 },
        }),
      };

      reviewManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithReview
      );

      // Create a plan file with all tasks complete
      const planContent = `# Implementation Plan

### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done
`;

      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);
      setupWorkerCompleteSignal();

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      // Worker has stopped (triggers handleWorkerStopped which reads .worker-status)
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: false });

      const callback = vi.fn();
      reviewManager.onEvent(callback);

      await reviewManager.startLoop('test-repo', '1');

      // Wait for the poll cycle to execute
      await vi.advanceTimersByTimeAsync(5000);

      // Review agent should have been called
      expect(invokeReviewAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          worktreePath: tempDir,
          githubOwner: 'test-owner',
          githubRepo: 'test-repo',
          issueNumber: 1,
        })
      );
    });

    it('should create PR on APPROVED verdict', async () => {
      vi.mocked(invokeReviewAgent).mockResolvedValue({
        success: true,
        verdict: { status: 'APPROVED', summary: 'Code looks good' },
        durationMs: 1000,
      });

      vi.mocked(createPullRequest).mockResolvedValue({
        success: true,
        url: 'https://github.com/test-owner/test-repo/pull/1',
        number: 1,
      });

      vi.mocked(notifyPRReady).mockResolvedValue({ success: true });

      const configWithReview: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: true,
          },
        }),
      };

      reviewManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithReview
      );

      const planContent = `### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done
`;
      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);
      setupWorkerCompleteSignal();

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: false });

      const callback = vi.fn();
      reviewManager.onEvent(callback);

      await reviewManager.startLoop('test-repo', '1');
      await vi.advanceTimersByTimeAsync(5000);

      // PR should have been created
      expect(createPullRequest).toHaveBeenCalled();

      // PR ready notification should have been sent
      expect(notifyPRReady).toHaveBeenCalled();

      // Loop should be done
      expect(callback).toHaveBeenCalledWith('loop_done', expect.any(Object));
    });

    it('should increment reviewCycle on NEEDS_WORK verdict', async () => {
      vi.mocked(invokeReviewAgent).mockResolvedValue({
        success: true,
        verdict: {
          status: 'NEEDS_WORK',
          summary: 'Tests are failing',
          feedback: 'Please fix the failing tests',
        },
        durationMs: 1000,
      });

      const configWithReview: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: true,
          },
          reviewConfig: { maxCycles: 3, timeoutMs: 300_000 },
        }),
      };

      // Mock restart to prevent infinite timer loop
      mockMultiRepoService.restart = vi.fn().mockResolvedValue(undefined);

      reviewManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithReview
      );

      const planContent = `### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done
`;
      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);
      setupWorkerCompleteSignal();

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: false });

      await reviewManager.startLoop('test-repo', '1');
      await vi.advanceTimersByTimeAsync(5000);

      // Check that reviewCycle was incremented
      const state = reviewManager.getLoopState('test-repo', '1');
      expect(state?.reviewCycle).toBe(1);

      // Check that review feedback file was written
      const feedbackPath = path.join(tempDir, '.claude', 'review-feedback.md');
      expect(fsActual.existsSync(feedbackPath)).toBe(true);
      const feedbackContent = fsActual.readFileSync(feedbackPath, 'utf-8');
      expect(feedbackContent).toContain('Review Cycle');
      expect(feedbackContent).toContain('Tests are failing');
    });

    it('should mark stuck after maxCycles NEEDS_WORK verdicts', async () => {
      vi.mocked(invokeReviewAgent).mockResolvedValue({
        success: true,
        verdict: {
          status: 'NEEDS_WORK',
          summary: 'Tests are failing',
          feedback: 'Please fix the failing tests',
        },
        durationMs: 1000,
      });

      vi.mocked(notifyReviewStuck).mockResolvedValue({ success: true });

      const configWithReview: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: true,
          },
          reviewConfig: { maxCycles: 1, timeoutMs: 300_000 }, // Only 1 cycle allowed
        }),
      };

      reviewManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithReview
      );

      const planContent = `### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done
`;
      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);
      setupWorkerCompleteSignal();

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: false });

      const callback = vi.fn();
      reviewManager.onEvent(callback);

      await reviewManager.startLoop('test-repo', '1');
      await vi.advanceTimersByTimeAsync(5000);

      // Should notify stuck
      expect(notifyReviewStuck).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewCycle: 1,
          githubOwner: 'test-owner',
          githubRepo: 'test-repo',
        })
      );

      // Loop should be stuck
      expect(callback).toHaveBeenCalledWith('loop_stuck', expect.any(Object));
    });

    it('should handle review agent failure as NEEDS_WORK', async () => {
      vi.mocked(invokeReviewAgent).mockResolvedValue({
        success: false,
        error: 'Review agent timed out',
        durationMs: 300_000,
      });

      const configWithReview: CentralConfig = {
        ...mockCentralConfig,
        ralph: createRalphConfig({
          promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
          doneSignal: { type: 'exit_code', value: '0' },
          iterationDelayMs: 100,
          gitOperations: {
            commitAfterEach: false,
            pushAfterEach: false,
            createPrOnComplete: true,
          },
          reviewConfig: { maxCycles: 3, timeoutMs: 300_000 },
        }),
      };

      // Mock restart to prevent infinite timer loop
      mockMultiRepoService.restart = vi.fn().mockResolvedValue(undefined);

      reviewManager = new RalphLoopManager(
        mockMultiRepoService as MultiRepoService,
        configWithReview
      );

      const planContent = `### Task 0: Setup
- [x] **Description**: Initial setup
- **Phase**: 0
- **Depends-On**: None
- **Acceptance**: Done
`;
      fsActual.writeFileSync(path.join(tempDir, 'IMPLEMENTATION_PLAN.md'), planContent);
      setupWorkerCompleteSignal();

      const mockSession = createMockSession({
        status: 'working',
        worktreePath: tempDir,
        spawnId: 'test-spawn-id',
      });
      vi.mocked(mockMultiRepoService.getSession!).mockResolvedValue(mockSession);
      vi.mocked(mockMultiRepoService.getWorkerStatus!).mockResolvedValue({ running: false });

      await reviewManager.startLoop('test-repo', '1');
      await vi.advanceTimersByTimeAsync(5000);

      // Check that reviewCycle was incremented (failure treated as NEEDS_WORK)
      const state = reviewManager.getLoopState('test-repo', '1');
      expect(state?.reviewCycle).toBe(1);
      expect(state?.lastReviewVerdict?.status).toBe('NEEDS_WORK');
    });
  });
});
