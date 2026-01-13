import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionStore } from './session-store.js';
import { SessionState, SessionContext, SessionDynamicState, IssueRef } from './types.js';

describe('SessionStore', () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
    store = new SessionStore('test-project', tempDir);
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

  const createTestSession = (id: string, issueNumbers: number[]): SessionState => ({
    id,
    issues: issueNumbers.map(createTestIssue),
    status: 'working',
    mode: 'single',
    branch: issueNumbers.length === 1 ? `issue-${issueNumbers[0]}` : `issues-${issueNumbers.join('-')}`,
    worktreePath: `/tmp/test-worktree-${id}`,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  });

  describe('save and load', () => {
    it('should save and load a session', async () => {
      const session = createTestSession('123', [123]);

      await store.save(session);
      const loaded = await store.load('123');

      expect(loaded).toEqual(session);
    });

    it('should return null for non-existent session', async () => {
      const loaded = await store.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('should overwrite existing session', async () => {
      const session1 = createTestSession('123', [123]);
      const session2 = { ...session1, status: 'stuck' as const, stuckReason: 'Test reason' };

      await store.save(session1);
      await store.save(session2);
      const loaded = await store.load('123');

      expect(loaded?.status).toBe('stuck');
      expect(loaded?.stuckReason).toBe('Test reason');
    });

    it('should save and load multi-issue session', async () => {
      const session = createTestSession('123', [123, 456, 789]);

      await store.save(session);
      const loaded = await store.load('123');

      expect(loaded).toEqual(session);
      expect(loaded?.issues).toHaveLength(3);
      expect(loaded?.issues[0].number).toBe(123);
      expect(loaded?.issues[1].number).toBe(456);
      expect(loaded?.issues[2].number).toBe(789);
    });
  });

  describe('listActive', () => {
    it('should return empty array when no sessions', async () => {
      const sessions = await store.listActive();
      expect(sessions).toEqual([]);
    });

    it('should return active sessions sorted by primary issue number', async () => {
      await store.save(createTestSession('456', [456]));
      await store.save(createTestSession('123', [123]));
      await store.save(createTestSession('789', [789]));

      const sessions = await store.listActive();

      expect(sessions).toHaveLength(3);
      expect(sessions[0].issues[0].number).toBe(123);
      expect(sessions[1].issues[0].number).toBe(456);
      expect(sessions[2].issues[0].number).toBe(789);
    });

    it('should exclude completed sessions', async () => {
      const active = createTestSession('123', [123]);
      const completed = { ...createTestSession('456', [456]), status: 'complete' as const };

      await store.save(active);
      await store.save(completed);

      const sessions = await store.listActive();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].issues[0].number).toBe(123);
    });

    it('should exclude cancelled sessions', async () => {
      const active = createTestSession('123', [123]);
      const cancelled = { ...createTestSession('456', [456]), status: 'cancelled' as const };

      await store.save(active);
      await store.save(cancelled);

      const sessions = await store.listActive();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].issues[0].number).toBe(123);
    });
  });

  describe('listAll', () => {
    it('should include completed and cancelled sessions', async () => {
      await store.save(createTestSession('123', [123]));
      await store.save({ ...createTestSession('456', [456]), status: 'complete' as const });
      await store.save({ ...createTestSession('789', [789]), status: 'cancelled' as const });

      const sessions = await store.listAll();

      expect(sessions).toHaveLength(3);
    });
  });

  describe('delete', () => {
    it('should delete a session', async () => {
      const session = createTestSession('123', [123]);

      await store.save(session);
      await store.delete('123');
      const loaded = await store.load('123');

      expect(loaded).toBeNull();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing session', async () => {
      await store.save(createTestSession('123', [123]));
      expect(store.exists('123')).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(store.exists('non-existent')).toBe(false);
    });
  });

  describe('worktree context files', () => {
    let worktreePath: string;

    beforeEach(() => {
      worktreePath = path.join(tempDir, 'test-worktree');
      fs.mkdirSync(worktreePath, { recursive: true });
    });

    it('should write and read session context', async () => {
      const context: SessionContext = {
        sessionId: '123',
        issues: [createTestIssue(123)],
        github: { owner: 'test-owner', repo: 'test-repo' },
        branch: 'issue-123',
        worktreePath,
        commands: {
          update: 'orch update --id 123',
          heartbeat: 'orch heartbeat --id 123',
        },
        spawnedAt: new Date().toISOString(),
        sessionFilePath: path.join(worktreePath, '..', 'sessions', '123.json'),
      };

      await store.writeSessionContext(worktreePath, context);
      const loaded = await store.readSessionContext(worktreePath);

      expect(loaded).toEqual(context);
    });

    it('should write and read multi-issue session context', async () => {
      const context: SessionContext = {
        sessionId: '123',
        issues: [createTestIssue(123), createTestIssue(456)],
        github: { owner: 'test-owner', repo: 'test-repo' },
        branch: 'issues-123-456',
        worktreePath,
        commands: {
          update: 'orch update --id 123',
          heartbeat: 'orch heartbeat --id 123',
        },
        spawnedAt: new Date().toISOString(),
        sessionFilePath: path.join(worktreePath, '..', 'sessions', '123.json'),
      };

      await store.writeSessionContext(worktreePath, context);
      const loaded = await store.readSessionContext(worktreePath);

      expect(loaded).toEqual(context);
      expect(loaded?.issues).toHaveLength(2);
    });

    it('should write and read session state', async () => {
      const state: SessionDynamicState = {
        status: 'working',
        forwardedMessage: 'Test message',
        lastUpdated: new Date().toISOString(),
      };

      await store.writeSessionState(worktreePath, state);
      const loaded = await store.readSessionState(worktreePath);

      expect(loaded).toEqual(state);
    });

    it('should return null for missing context file', async () => {
      const loaded = await store.readSessionContext(worktreePath);
      expect(loaded).toBeNull();
    });

    it('should return null for missing state file', async () => {
      const loaded = await store.readSessionState(worktreePath);
      expect(loaded).toBeNull();
    });
  });
});
