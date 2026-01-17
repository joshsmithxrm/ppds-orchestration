import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionService, SessionServiceConfig, createSessionService } from './session-service.js';
import { SessionState, IssueRef } from './types.js';

// Mock worker spawner that doesn't actually spawn terminals
const mockSpawner = {
  isAvailable: () => true,
  spawn: vi.fn().mockResolvedValue({ success: true, spawnId: 'mock-spawn-id', spawnedAt: new Date().toISOString() }),
  getName: () => 'Mock Spawner',
  stop: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue({ running: false }),
};

describe('SessionService', () => {
  let tempDir: string;
  let repoRoot: string;
  let service: SessionService;
  let config: SessionServiceConfig;

  beforeEach(() => {
    // Create temp directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    repoRoot = path.join(tempDir, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });

    // Create a fake .git directory to simulate a repo
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });

    config = {
      projectName: 'test-project',
      repoRoot,
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
      baseDir: tempDir,
      spawner: mockSpawner,
      worktreePrefix: 'test-issue-',
    };

    service = new SessionService(config);
    mockSpawner.spawn.mockClear();
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestIssue = (number: number): IssueRef => ({
    number,
    title: `Test issue #${number}`,
    body: `Description for issue #${number}`,
  });

  const createTestSession = (id: string, issueNumber: number, worktreePath: string): SessionState => ({
    id,
    issue: createTestIssue(issueNumber),
    status: 'working',
    mode: 'manual',
    branch: `issue-${issueNumber}`,
    worktreePath,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  });

  describe('list', () => {
    it('should return empty array when no sessions', async () => {
      const sessions = await service.list();
      expect(sessions).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update session status', async () => {
      // Create a session file directly
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      const session = createTestSession('123', 123, worktreePath);

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      const updated = await service.update('123', 'stuck', { reason: 'Test reason' });

      expect(updated.status).toBe('stuck');
      expect(updated.stuckReason).toBe('Test reason');
    });

    it('should throw for non-existent session', async () => {
      await expect(service.update('non-existent', 'working')).rejects.toThrow(
        "Session 'non-existent' not found"
      );
    });
  });

  describe('pause and resume', () => {
    let sessionsDir: string;
    let worktreePath: string;

    beforeEach(() => {
      sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      const session = createTestSession('123', 123, worktreePath);

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );
    });

    it('should pause a working session', async () => {
      const paused = await service.pause('123');
      expect(paused.status).toBe('paused');
    });

    it('should resume a paused session', async () => {
      await service.pause('123');
      const resumed = await service.resume('123');
      expect(resumed.status).toBe('working');
    });

    it('should be idempotent for already paused session', async () => {
      await service.pause('123');
      const paused = await service.pause('123');
      expect(paused.status).toBe('paused');
    });

    it('should reject pause on completed session', async () => {
      // Update session to complete status
      const sessionPath = path.join(sessionsDir, 'work-123.json');
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      session.status = 'complete';
      fs.writeFileSync(sessionPath, JSON.stringify(session));

      await expect(service.pause('123')).rejects.toThrow('Cannot pause a completed session');
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      // Mock GitUtils.removeWorktree since test worktrees aren't real git worktrees
      vi.spyOn(service['gitUtils'], 'removeWorktree').mockResolvedValue({ success: true });
    });

    it('should delete a session and remove worktree', async () => {
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      const session = createTestSession('123', 123, worktreePath);

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      await service.delete('123');

      // Session file should be deleted
      expect(fs.existsSync(path.join(sessionsDir, 'work-123.json'))).toBe(false);
    });

    it('should throw if session not found', async () => {
      await expect(service.delete('non-existent')).rejects.toThrow(
        "Session 'non-existent' not found"
      );
    });

    it('should delete completed sessions', async () => {
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      const session: SessionState = {
        ...createTestSession('123', 123, worktreePath),
        status: 'complete',
      };

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      // Should not throw - delete works on any status
      await service.delete('123');
      expect(fs.existsSync(path.join(sessionsDir, 'work-123.json'))).toBe(false);
    });
  });

  describe('restart', () => {
    let sessionsDir: string;
    let worktreePath: string;

    beforeEach(() => {
      sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create .claude directory with prompt file
      const claudeDir = path.join(worktreePath, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'session-prompt.md'), '# Test prompt');
    });

    it('should throw if session not found', async () => {
      await expect(service.restart('non-existent')).rejects.toThrow(
        "Session 'non-existent' not found"
      );
    });

    it('should throw if session is in terminal state', async () => {
      const session: SessionState = {
        ...createTestSession('123', 123, worktreePath),
        status: 'cancelled',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-123.json'), JSON.stringify(session));

      await expect(service.restart('123')).rejects.toThrow(
        'Cannot restart cancelled sessions'
      );
    });

    it('should allow restarting non-terminal sessions', async () => {
      const session: SessionState = {
        ...createTestSession('123', 123, worktreePath),
        status: 'working',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-123.json'), JSON.stringify(session));

      // Should not throw - non-terminal sessions can be restarted
      const result = await service.restart('123');
      expect(result.status).toBe('working');
    });

    it('should throw if worktree does not exist', async () => {
      const nonExistentWorktree = path.join(tempDir, 'non-existent-worktree');
      const session: SessionState = {
        ...createTestSession('123', 123, nonExistentWorktree),
        status: 'stuck',
        stuckReason: 'Test stuck reason',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-123.json'), JSON.stringify(session));

      await expect(service.restart('123')).rejects.toThrow(
        `Worktree no longer exists at ${nonExistentWorktree}`
      );
    });

    it('should throw if prompt file does not exist', async () => {
      // Remove the prompt file
      fs.unlinkSync(path.join(worktreePath, '.claude', 'session-prompt.md'));

      const session: SessionState = {
        ...createTestSession('123', 123, worktreePath),
        status: 'stuck',
        stuckReason: 'Test stuck reason',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-123.json'), JSON.stringify(session));

      await expect(service.restart('123')).rejects.toThrow(
        `Worker prompt not found at ${path.join(worktreePath, '.claude', 'session-prompt.md')}`
      );
    });

    it('should restart stuck session and update status to working', async () => {
      const session: SessionState = {
        ...createTestSession('123', 123, worktreePath),
        status: 'stuck',
        stuckReason: 'Need guidance',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-123.json'), JSON.stringify(session));

      const restarted = await service.restart('123');

      expect(restarted.status).toBe('working');
      expect(restarted.stuckReason).toBeUndefined();
      expect(mockSpawner.spawn).toHaveBeenCalledOnce();
    });
  });

  describe('spawn overlap detection', () => {
    let sessionsDir: string;

    beforeEach(() => {
      sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
    });

    it('should throw if issue is already in an active session', async () => {
      const worktreePath = path.join(tempDir, 'existing-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create an existing session with issue 2
      const existingSession: SessionState = {
        ...createTestSession('2', 2, worktreePath),
        status: 'working',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-2.json'), JSON.stringify(existingSession));

      // Try to spawn a session for issue 2
      await expect(service.spawn(2)).rejects.toThrow(
        "Issue #2 already in active session '2'"
      );
    });

    it('should allow spawn if overlapping session is completed', async () => {
      const worktreePath = path.join(tempDir, 'existing-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create a completed session with issue 2
      const existingSession: SessionState = {
        ...createTestSession('2', 2, worktreePath),
        status: 'complete',
      };
      fs.writeFileSync(path.join(sessionsDir, 'work-2.json'), JSON.stringify(existingSession));

      // This should not throw (completed sessions don't block)
      // Note: This will fail at GitHub fetch step, but we're testing the overlap detection
      await expect(service.spawn(2)).rejects.toThrow(/Failed to fetch issue/);
    });
  });

  describe('heartbeat', () => {
    it('should update lastHeartbeat', async () => {
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const oldDate = new Date(Date.now() - 60000).toISOString();
      const session: SessionState = {
        ...createTestSession('123', 123, '/tmp/test'),
        startedAt: oldDate,
        lastHeartbeat: oldDate,
      };

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      await service.heartbeat('123');

      const updated = await service.get('123');
      expect(new Date(updated!.lastHeartbeat).getTime()).toBeGreaterThan(
        new Date(oldDate).getTime()
      );
    });
  });

  describe('isStale', () => {
    it('should return true for session with old heartbeat', () => {
      const oldDate = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
      const session: SessionState = {
        ...createTestSession('123', 123, '/tmp/test'),
        startedAt: oldDate,
        lastHeartbeat: oldDate,
      };

      expect(service.isStale(session)).toBe(true);
    });

    it('should return false for session with recent heartbeat', () => {
      const session = createTestSession('123', 123, '/tmp/test');

      expect(service.isStale(session)).toBe(false);
    });
  });
});

// These tests only run on Windows because createSessionService uses createSpawner()
// which is only implemented for Windows Terminal
describe.skipIf(process.platform !== 'win32')('createSessionService', () => {
  let tempDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-config-test-'));
    repoRoot = path.join(tempDir, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should correctly extract baseDir from sessionsDir config', async () => {
    // This tests the fix for the path duplication bug
    // Config has sessionsDir like ~/.orchestration/{project}/sessions
    // We need to extract just ~/.orchestration as baseDir
    const orchestrationRoot = path.join(tempDir, '.orchestration');
    const projectName = 'test-project';
    const fullSessionsDir = path.join(orchestrationRoot, projectName, 'sessions');

    // Create config file with sessionsDir specified
    const config = {
      version: '1.0',
      project: {
        github: {
          owner: 'test-owner',
          repo: projectName,
        },
      },
      dashboard: {
        sessionsDir: fullSessionsDir,
      },
    };

    fs.writeFileSync(
      path.join(repoRoot, 'orchestration.config.json'),
      JSON.stringify(config, null, 2)
    );

    // Change to repo directory for createSessionService
    const originalCwd = process.cwd();
    process.chdir(repoRoot);

    try {
      const service = await createSessionService();
      const sessionsDir = service.getSessionsDir();

      // The sessions dir should be exactly fullSessionsDir, not doubled
      expect(sessionsDir).toBe(fullSessionsDir);
      // It should NOT contain the project name twice
      expect(sessionsDir).not.toContain(`${projectName}${path.sep}sessions${path.sep}${projectName}`);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should use default baseDir when sessionsDir not specified', async () => {
    const projectName = 'test-project';

    // Create config file without sessionsDir
    const config = {
      version: '1.0',
      project: {
        github: {
          owner: 'test-owner',
          repo: projectName,
        },
      },
    };

    fs.writeFileSync(
      path.join(repoRoot, 'orchestration.config.json'),
      JSON.stringify(config, null, 2)
    );

    const originalCwd = process.cwd();
    process.chdir(repoRoot);

    try {
      const service = await createSessionService();
      const sessionsDir = service.getSessionsDir();

      // Should use default ~/.orchestration/{project}/sessions
      const expectedDir = path.join(os.homedir(), '.orchestration', projectName, 'sessions');
      expect(sessionsDir).toBe(expectedDir);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
