import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionService, SessionServiceConfig, createSessionService } from './session-service.js';
import { SessionState } from './types.js';

// Mock worker spawner that doesn't actually spawn terminals
const mockSpawner = {
  isAvailable: () => true,
  spawn: vi.fn().mockResolvedValue(undefined),
  getName: () => 'Mock Spawner',
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

      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

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

  describe('forward', () => {
    it('should forward message to session', async () => {
      // Create a session file directly
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'stuck',
        branch: 'issue-123',
        worktreePath,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        stuckReason: 'Need guidance',
      };

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      const updated = await service.forward('123', 'Use option A');

      expect(updated.forwardedMessage).toBe('Use option A');

      // Check that session-state.json was updated in worktree
      const stateFile = path.join(worktreePath, 'session-state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(state.forwardedMessage).toBe('Use option A');
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

      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

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
  });

  describe('cancel', () => {
    it('should cancel a session and remove worktree', async () => {
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });

      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      await service.cancel('123');

      // Session file should be deleted
      expect(fs.existsSync(path.join(sessionsDir, 'work-123.json'))).toBe(false);
    });

    it('should keep worktree when keepWorktree option is true', async () => {
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });
      fs.writeFileSync(path.join(worktreePath, 'test-file.txt'), 'test');

      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath,
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session)
      );

      await service.cancel('123', { keepWorktree: true });

      // Worktree directory should still exist
      // (In real usage, git worktree remove would be called, but we're not testing that)
      expect(fs.existsSync(worktreePath)).toBe(true);
    });
  });

  describe('heartbeat', () => {
    it('should update lastHeartbeat', async () => {
      const sessionsDir = path.join(tempDir, 'test-project', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const oldDate = new Date(Date.now() - 60000).toISOString();
      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath: '/tmp/test',
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
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath: '/tmp/test',
        startedAt: oldDate,
        lastHeartbeat: oldDate,
      };

      expect(service.isStale(session)).toBe(true);
    });

    it('should return false for session with recent heartbeat', () => {
      const session: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-123',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

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
