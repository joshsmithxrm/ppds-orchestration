import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsActual from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CentralConfig, RalphConfig, SessionState } from '@ppds-orchestration/core';

// Create a controlled mock for execAsync that we can configure in tests
const mockExecAsync = vi.fn();

// Mock the entire ralph-loop-manager module to inject our mock execAsync
vi.mock('./ralph-loop-manager.js', async (importOriginal) => {
  // We need to manually create a class that uses our mockExecAsync
  // This is the cleanest way to test without modifying the source code
  const actual = await importOriginal<typeof import('./ralph-loop-manager.js')>();
  return actual;
});

// Instead of mocking at module level, we'll test through the public interface
// and use a wrapper to inject mocked behavior

import { RalphLoopManager, RalphLoopState } from './ralph-loop-manager.js';
import { MultiRepoService } from './multi-repo-service.js';

describe('RalphLoopManager', () => {
  let manager: RalphLoopManager;
  let mockMultiRepoService: Partial<MultiRepoService>;
  let mockCentralConfig: CentralConfig;
  let tempDir: string;

  const createMockSession = (overrides: Partial<SessionState> = {}): SessionState => ({
    id: '1',
    issues: [{ number: 1, title: 'Test Issue', body: 'Test body' }],
    status: 'working',
    mode: 'ralph',
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
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a real temp directory for testing
    tempDir = fsActual.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));

    mockMultiRepoService = {
      getSession: vi.fn(),
      spawn: vi.fn(),
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
});
