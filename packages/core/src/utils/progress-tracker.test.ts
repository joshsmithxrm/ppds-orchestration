import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendProgress,
  readProgress,
  getLatestProgress,
  calculateCompletionPercentage,
  formatProgressEntry,
  getProgressFilePath,
  type ProgressEntry,
} from './progress-tracker.js';

describe('progress-tracker', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getProgressFilePath', () => {
    it('should return path to progress.json in .claude directory', () => {
      const result = getProgressFilePath('/some/worktree');
      expect(result).toBe(path.join('/some/worktree', '.claude', 'progress.json'));
    });
  });

  describe('appendProgress', () => {
    it('should create progress file if it does not exist', async () => {
      const entry = {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 2,
        status: 'working',
      };

      await appendProgress(tempDir, entry);

      const filePath = getProgressFilePath(tempDir);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should append entry with auto-generated timestamp', async () => {
      const entry = {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 2,
        status: 'working',
      };

      await appendProgress(tempDir, entry);

      const progress = await readProgress(tempDir);
      expect(progress).not.toBeNull();
      expect(progress!.entries).toHaveLength(1);
      expect(progress!.entries[0].timestamp).toBeDefined();
      expect(progress!.entries[0].sessionId).toBe('123');
    });

    it('should preserve custom timestamp if provided', async () => {
      const customTimestamp = '2024-01-15T10:30:00.000Z';
      const entry = {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 2,
        status: 'working',
        timestamp: customTimestamp,
      };

      await appendProgress(tempDir, entry);

      const progress = await readProgress(tempDir);
      expect(progress!.entries[0].timestamp).toBe(customTimestamp);
    });

    it('should append multiple entries', async () => {
      await appendProgress(tempDir, {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 1,
        status: 'working',
      });

      await appendProgress(tempDir, {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 2,
        status: 'working',
      });

      await appendProgress(tempDir, {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 5,
        status: 'complete',
      });

      const progress = await readProgress(tempDir);
      expect(progress!.entries).toHaveLength(3);
      expect(progress!.entries[0].completedTasks).toBe(1);
      expect(progress!.entries[2].completedTasks).toBe(5);
    });

    it('should include optional fields', async () => {
      const entry = {
        sessionId: '123',
        issueNumber: 123,
        iteration: 3,
        totalTasks: 10,
        completedTasks: 7,
        status: 'working',
        message: 'Making good progress',
      };

      await appendProgress(tempDir, entry);

      const progress = await readProgress(tempDir);
      expect(progress!.entries[0].iteration).toBe(3);
      expect(progress!.entries[0].message).toBe('Making good progress');
    });
  });

  describe('readProgress', () => {
    it('should return null if file does not exist', async () => {
      const result = await readProgress(tempDir);
      expect(result).toBeNull();
    });

    it('should return progress data if file exists', async () => {
      await appendProgress(tempDir, {
        sessionId: '456',
        issueNumber: 456,
        totalTasks: 3,
        completedTasks: 1,
        status: 'planning',
      });

      const result = await readProgress(tempDir);
      expect(result).not.toBeNull();
      expect(result!.createdAt).toBeDefined();
      expect(result!.updatedAt).toBeDefined();
      expect(result!.entries).toHaveLength(1);
    });
  });

  describe('getLatestProgress', () => {
    it('should return null if no progress exists', async () => {
      const result = await getLatestProgress(tempDir);
      expect(result).toBeNull();
    });

    it('should return the most recent entry', async () => {
      await appendProgress(tempDir, {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 1,
        status: 'working',
      });

      await appendProgress(tempDir, {
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 5,
        status: 'complete',
      });

      const result = await getLatestProgress(tempDir);
      expect(result).not.toBeNull();
      expect(result!.completedTasks).toBe(5);
      expect(result!.status).toBe('complete');
    });
  });

  describe('calculateCompletionPercentage', () => {
    it('should calculate correct percentage', () => {
      const entry: ProgressEntry = {
        timestamp: new Date().toISOString(),
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 10,
        completedTasks: 7,
        status: 'working',
      };

      expect(calculateCompletionPercentage(entry)).toBe(70);
    });

    it('should return 0 for zero total tasks', () => {
      const entry: ProgressEntry = {
        timestamp: new Date().toISOString(),
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 0,
        completedTasks: 0,
        status: 'working',
      };

      expect(calculateCompletionPercentage(entry)).toBe(0);
    });

    it('should return 100 for all completed', () => {
      const entry: ProgressEntry = {
        timestamp: new Date().toISOString(),
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 5,
        status: 'complete',
      };

      expect(calculateCompletionPercentage(entry)).toBe(100);
    });

    it('should round to nearest integer', () => {
      const entry: ProgressEntry = {
        timestamp: new Date().toISOString(),
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 3,
        completedTasks: 1,
        status: 'working',
      };

      expect(calculateCompletionPercentage(entry)).toBe(33);
    });
  });

  describe('formatProgressEntry', () => {
    it('should format basic entry', () => {
      const entry: ProgressEntry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 3,
        status: 'working',
      };

      const result = formatProgressEntry(entry);
      expect(result).toBe('[2024-01-15T10:30:00.000Z] #123: 3/5 tasks (60%) - working');
    });

    it('should include iteration if present', () => {
      const entry: ProgressEntry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        sessionId: '123',
        issueNumber: 123,
        iteration: 5,
        totalTasks: 10,
        completedTasks: 8,
        status: 'working',
      };

      const result = formatProgressEntry(entry);
      expect(result).toContain('(iteration 5)');
    });

    it('should include message if present', () => {
      const entry: ProgressEntry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        sessionId: '123',
        issueNumber: 123,
        totalTasks: 5,
        completedTasks: 5,
        status: 'complete',
        message: 'All done!',
      };

      const result = formatProgressEntry(entry);
      expect(result).toContain('- All done!');
    });
  });
});
