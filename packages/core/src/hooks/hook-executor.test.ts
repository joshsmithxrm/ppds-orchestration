import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'node:os';
import { HookExecutor } from './hook-executor.js';
import type { SessionState, IssueRef } from '../session/types.js';
import type { HookConfig } from '../config/central-config.js';

// Use PowerShell-compatible commands for Windows
const isWindows = process.platform === 'win32';
const echoCmd = isWindows ? 'cmd /c echo' : 'echo';
const exitCmd = isWindows ? 'cmd /c exit' : 'exit';

// Use temp dir as worktree path (must exist for spawn cwd)
const tempDir = os.tmpdir();

describe('HookExecutor', () => {
  let executor: HookExecutor;

  const mockIssue: IssueRef = {
    number: 123,
    title: 'Test Issue',
    body: 'Test issue description',
  };

  const mockSession: SessionState = {
    id: '123',
    issue: mockIssue,
    status: 'working',
    mode: 'manual',
    branch: 'issue-123',
    worktreePath: tempDir,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  };

  const mockContext = {
    session: mockSession,
    repoId: 'test-repo',
    worktreePath: tempDir,
  };

  beforeEach(() => {
    executor = new HookExecutor();
  });

  describe('execute', () => {
    it('returns null for prompt hooks', async () => {
      const hook: HookConfig = { type: 'prompt', value: 'some prompt text' };
      const result = await executor.execute(hook, mockContext);
      expect(result).toBeNull();
    });

    it('executes simple command hooks', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} hello` };
      const result = await executor.execute(hook, mockContext);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.output?.toLowerCase()).toContain('hello');
      expect(result?.duration).toBeGreaterThanOrEqual(0);
    });

    it('substitutes ${issueNumber} variable', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} \${issueNumber}` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(true);
      expect(result?.output).toContain('123');
    });

    it('substitutes ${sessionId} variable', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} \${sessionId}` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(true);
      expect(result?.output).toContain('123');
    });

    it('substitutes ${repoId} variable', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} \${repoId}` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(true);
      expect(result?.output).toContain('test-repo');
    });

    it('substitutes ${branch} variable', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} \${branch}` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(true);
      expect(result?.output).toContain('issue-123');
    });

    it('substitutes ${status} variable', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} \${status}` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(true);
      expect(result?.output).toContain('working');
    });

    it('substitutes multiple variables', async () => {
      const hook: HookConfig = {
        type: 'command',
        value: `${echoCmd} \${repoId} \${issueNumber} \${status}`,
      };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(true);
      expect(result?.output).toContain('test-repo');
      expect(result?.output).toContain('123');
      expect(result?.output).toContain('working');
    });

    it('reports failure for non-zero exit codes', async () => {
      const hook: HookConfig = { type: 'command', value: `${exitCmd} 1` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.success).toBe(false);
    });

    it('tracks duration', async () => {
      const hook: HookConfig = { type: 'command', value: `${echoCmd} fast` };
      const result = await executor.execute(hook, mockContext);

      expect(result?.duration).toBeDefined();
      expect(result?.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('executeByName', () => {
    it('returns null when hook does not exist', async () => {
      const hooks: Record<string, HookConfig> = {};
      const result = await executor.executeByName('onSpawn', hooks, mockContext);
      expect(result).toBeNull();
    });

    it('executes hook when it exists', async () => {
      const hooks: Record<string, HookConfig> = {
        onSpawn: { type: 'command', value: `${echoCmd} spawned` },
      };
      const result = await executor.executeByName('onSpawn', hooks, mockContext);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.output?.toLowerCase()).toContain('spawned');
    });

    it('returns null for prompt hooks', async () => {
      const hooks: Record<string, HookConfig> = {
        onSpawn: { type: 'prompt', value: 'some prompt' },
      };
      const result = await executor.executeByName('onSpawn', hooks, mockContext);
      expect(result).toBeNull();
    });
  });
});
