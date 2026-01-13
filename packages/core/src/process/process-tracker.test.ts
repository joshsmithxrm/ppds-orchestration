import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessTracker } from './process-tracker.js';

describe('ProcessTracker', () => {
  let tracker: ProcessTracker;

  beforeEach(() => {
    tracker = new ProcessTracker();
  });

  afterEach(() => {
    tracker.dispose();
  });

  describe('track/untrack', () => {
    it('tracks processes', () => {
      tracker.track(1234, 'session-1', 'repo-1');

      const tracked = tracker.getTracked();
      expect(tracked).toHaveLength(1);
      expect(tracked[0].pid).toBe(1234);
      expect(tracked[0].sessionId).toBe('session-1');
      expect(tracked[0].repoId).toBe('repo-1');
    });

    it('tracks multiple processes', () => {
      tracker.track(1234, 'session-1', 'repo-1');
      tracker.track(5678, 'session-2', 'repo-1');

      const tracked = tracker.getTracked();
      expect(tracked).toHaveLength(2);
    });

    it('untracks processes', () => {
      tracker.track(1234, 'session-1', 'repo-1');
      tracker.untrack(1234);

      expect(tracker.getTracked()).toHaveLength(0);
    });

    it('only untracks the specified process', () => {
      tracker.track(1234, 'session-1', 'repo-1');
      tracker.track(5678, 'session-2', 'repo-1');
      tracker.untrack(1234);

      const tracked = tracker.getTracked();
      expect(tracked).toHaveLength(1);
      expect(tracked[0].pid).toBe(5678);
    });

    it('records startedAt timestamp', () => {
      const before = new Date().toISOString();
      tracker.track(1234, 'session-1', 'repo-1');
      const after = new Date().toISOString();

      const tracked = tracker.getTracked();
      expect(tracked[0].startedAt).toBeDefined();
      expect(tracked[0].startedAt >= before).toBe(true);
      expect(tracked[0].startedAt <= after).toBe(true);
    });
  });

  describe('getBySession', () => {
    it('returns process by session ID', () => {
      tracker.track(1234, 'session-1', 'repo-1');
      tracker.track(5678, 'session-2', 'repo-1');

      const proc = tracker.getBySession('repo-1', 'session-1');
      expect(proc).toBeDefined();
      expect(proc?.pid).toBe(1234);
    });

    it('returns undefined for non-existent session', () => {
      tracker.track(1234, 'session-1', 'repo-1');

      const proc = tracker.getBySession('repo-1', 'session-99');
      expect(proc).toBeUndefined();
    });

    it('matches both repoId and sessionId', () => {
      tracker.track(1234, 'session-1', 'repo-1');
      tracker.track(5678, 'session-1', 'repo-2');

      const proc1 = tracker.getBySession('repo-1', 'session-1');
      expect(proc1?.pid).toBe(1234);

      const proc2 = tracker.getBySession('repo-2', 'session-1');
      expect(proc2?.pid).toBe(5678);
    });
  });

  describe('isRunning', () => {
    it('detects current process as running', async () => {
      const isRunning = await tracker.isRunning(process.pid);
      expect(isRunning).toBe(true);
    });

    it('detects non-existent process as not running', async () => {
      // Use a very high PID that's unlikely to exist
      const isRunning = await tracker.isRunning(999999);
      expect(isRunning).toBe(false);
    });
  });

  describe('onExit callback', () => {
    it('registers exit callback', () => {
      const callback = vi.fn();
      tracker.onExit(callback);

      // Callback registered but not called yet
      expect(callback).not.toHaveBeenCalled();
    });

    it('allows removing exit callback', () => {
      const callback = vi.fn();
      tracker.onExit(callback);
      tracker.offExit(callback);

      // No error should occur
    });
  });

  describe('dispose', () => {
    it('clears all tracked processes', () => {
      tracker.track(1234, 'session-1', 'repo-1');
      tracker.track(5678, 'session-2', 'repo-1');
      tracker.dispose();

      expect(tracker.getTracked()).toHaveLength(0);
    });
  });
});
