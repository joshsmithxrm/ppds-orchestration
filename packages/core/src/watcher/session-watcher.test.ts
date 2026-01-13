import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionWatcher, SessionWatcherCallback } from './session-watcher.js';
import { SessionState } from '../session/types.js';

describe('SessionWatcher', () => {
  let tempDir: string;
  let sessionsDir: string;
  let watcher: SessionWatcher;

  beforeEach(() => {
    // Create temp directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-watcher-test-'));
    sessionsDir = path.join(tempDir, 'sessions');
  });

  afterEach(async () => {
    // Stop watcher if running
    if (watcher) {
      await watcher.stop();
    }
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should accept a sessions directory path', () => {
      watcher = new SessionWatcher(sessionsDir);
      expect(watcher).toBeDefined();
    });
  });

  describe('start', () => {
    it('should create sessions directory if not exists', () => {
      expect(fs.existsSync(sessionsDir)).toBe(false);
      watcher = new SessionWatcher(sessionsDir);
      watcher.start();
      expect(fs.existsSync(sessionsDir)).toBe(true);
    });

    it('should be idempotent (calling twice is safe)', () => {
      watcher = new SessionWatcher(sessionsDir);
      watcher.start();
      watcher.start(); // Second call should not throw
      expect(fs.existsSync(sessionsDir)).toBe(true);
    });

    it('should emit add events for existing files', async () => {
      // Pre-create sessions directory and file
      fs.mkdirSync(sessionsDir, { recursive: true });
      const session: SessionState = {
        id: '42',
        issueNumber: 42,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-42',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(sessionsDir, 'work-42.json'),
        JSON.stringify(session)
      );

      const callback = vi.fn();
      watcher = new SessionWatcher(sessionsDir);
      watcher.on(callback);
      watcher.start();

      // Wait for chokidar to pick up existing file
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).toHaveBeenCalledWith('add', expect.objectContaining({ id: '42' }), '42');
    });
  });

  describe('stop', () => {
    it('should close watcher cleanly', async () => {
      watcher = new SessionWatcher(sessionsDir);
      watcher.start();
      await watcher.stop();
      // Should not throw and should allow stopping again
      await watcher.stop();
    });
  });

  describe('file change events', () => {
    beforeEach(() => {
      fs.mkdirSync(sessionsDir, { recursive: true });
      watcher = new SessionWatcher(sessionsDir);
    });

    it('should emit update event when file is changed', async () => {
      const callback = vi.fn();
      watcher.on(callback);
      watcher.start();

      // Create initial session file
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
      const filePath = path.join(sessionsDir, 'work-123.json');
      fs.writeFileSync(filePath, JSON.stringify(session));

      // Wait for add event
      await new Promise((resolve) => setTimeout(resolve, 300));
      callback.mockClear();

      // Update the file
      const updatedSession = { ...session, status: 'stuck' as const };
      fs.writeFileSync(filePath, JSON.stringify(updatedSession));

      // Wait for change event
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).toHaveBeenCalledWith(
        'update',
        expect.objectContaining({ status: 'stuck' }),
        '123'
      );
    });

    it('should emit remove event when file is deleted', async () => {
      const callback = vi.fn();
      watcher.on(callback);
      watcher.start();

      // Create session file
      const session: SessionState = {
        id: '456',
        issueNumber: 456,
        issueTitle: 'Test issue',
        status: 'working',
        branch: 'issue-456',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      const filePath = path.join(sessionsDir, 'work-456.json');
      fs.writeFileSync(filePath, JSON.stringify(session));

      // Wait for add event
      await new Promise((resolve) => setTimeout(resolve, 300));
      callback.mockClear();

      // Delete the file
      fs.unlinkSync(filePath);

      // Wait for unlink event
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).toHaveBeenCalledWith('remove', null, '456');
    });

    it('should handle invalid JSON gracefully without crashing', async () => {
      const callback = vi.fn();
      watcher.on(callback);
      watcher.start();

      // Write invalid JSON
      const filePath = path.join(sessionsDir, 'work-789.json');
      fs.writeFileSync(filePath, 'not valid json {{{');

      // Wait for event processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Callback should not have been called with parsed data
      // Watcher should still be running
      expect(fs.existsSync(sessionsDir)).toBe(true);
    });

    it('should ignore files that do not match work-*.json pattern', async () => {
      const callback = vi.fn();
      watcher.on(callback);
      watcher.start();

      await new Promise((resolve) => setTimeout(resolve, 100));
      callback.mockClear();

      // Write a file that doesn't match the pattern
      fs.writeFileSync(path.join(sessionsDir, 'other-file.json'), '{}');
      fs.writeFileSync(path.join(sessionsDir, 'work.json'), '{}');
      fs.writeFileSync(path.join(sessionsDir, 'readme.txt'), 'hello');

      await new Promise((resolve) => setTimeout(resolve, 300));

      // None of these should trigger callbacks
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('callback management', () => {
    it('should register multiple callbacks', async () => {
      fs.mkdirSync(sessionsDir, { recursive: true });
      watcher = new SessionWatcher(sessionsDir);

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      watcher.on(callback1);
      watcher.on(callback2);
      watcher.start();

      // Create session file
      const session: SessionState = {
        id: '100',
        issueNumber: 100,
        issueTitle: 'Test',
        status: 'working',
        branch: 'issue-100',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(sessionsDir, 'work-100.json'),
        JSON.stringify(session)
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should remove callback with off()', async () => {
      fs.mkdirSync(sessionsDir, { recursive: true });
      watcher = new SessionWatcher(sessionsDir);

      const callback = vi.fn();
      watcher.on(callback);
      watcher.off(callback);
      watcher.start();

      // Create session file
      const session: SessionState = {
        id: '200',
        issueNumber: 200,
        issueTitle: 'Test',
        status: 'working',
        branch: 'issue-200',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(sessionsDir, 'work-200.json'),
        JSON.stringify(session)
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle callback errors gracefully', async () => {
      fs.mkdirSync(sessionsDir, { recursive: true });
      watcher = new SessionWatcher(sessionsDir);

      const errorCallback: SessionWatcherCallback = () => {
        throw new Error('Callback error');
      };
      const normalCallback = vi.fn();

      watcher.on(errorCallback);
      watcher.on(normalCallback);
      watcher.start();

      // Create session file
      const session: SessionState = {
        id: '300',
        issueNumber: 300,
        issueTitle: 'Test',
        status: 'working',
        branch: 'issue-300',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(sessionsDir, 'work-300.json'),
        JSON.stringify(session)
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Normal callback should still be called despite error in first callback
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('extractSessionId', () => {
    it('should extract session ID from various file paths', async () => {
      fs.mkdirSync(sessionsDir, { recursive: true });
      watcher = new SessionWatcher(sessionsDir);

      const callback = vi.fn();
      watcher.on(callback);
      watcher.start();

      // Test numeric ID
      const session1: SessionState = {
        id: '123',
        issueNumber: 123,
        issueTitle: 'Test',
        status: 'working',
        branch: 'issue-123',
        worktreePath: '/tmp/test',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(sessionsDir, 'work-123.json'),
        JSON.stringify(session1)
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).toHaveBeenCalledWith('add', expect.anything(), '123');
    });
  });
});
