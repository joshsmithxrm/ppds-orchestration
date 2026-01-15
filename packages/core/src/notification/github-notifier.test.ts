import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  notifyPRReady,
  notifyImplementationStuck,
  notifyReviewStuck,
  type NotificationOptions,
} from './github-notifier.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

describe('GitHub Notifier', () => {
  const baseOptions: NotificationOptions = {
    githubOwner: 'test-owner',
    githubRepo: 'test-repo',
    issueNumber: 123,
    cwd: '/tmp/worktree',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockSuccessfulSpawn = () => {
    const mockProcess = {
      stdout: {
        on: vi.fn((event: string, handler: (data: Buffer) => void) => {
          if (event === 'data') {
            handler(Buffer.from('https://github.com/test-owner/test-repo/issues/123#comment'));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event: string, handler: (code?: number) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
      }),
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);
  };

  const mockFailedSpawn = (errorMessage: string) => {
    const mockProcess = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn((event: string, handler: (data: Buffer) => void) => {
          if (event === 'data') {
            handler(Buffer.from(errorMessage));
          }
        }),
      },
      on: vi.fn((event: string, handler: (code?: number) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(1), 10);
        }
      }),
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);
  };

  describe('notifyPRReady', () => {
    it('should post PR ready comment successfully', async () => {
      mockSuccessfulSpawn();

      const result = await notifyPRReady({
        ...baseOptions,
        prUrl: 'https://github.com/test-owner/test-repo/pull/456',
        prNumber: 456,
        summary: 'All tests passing',
      });

      expect(result.success).toBe(true);
      expect(result.commentUrl).toBeDefined();
    });

    it('should call gh issue comment with correct arguments', async () => {
      mockSuccessfulSpawn();

      await notifyPRReady({
        ...baseOptions,
        prUrl: 'https://github.com/test-owner/test-repo/pull/456',
        prNumber: 456,
      });

      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'issue', 'comment', '123',
          '--repo', 'test-owner/test-repo',
          '--body',
        ]),
        expect.objectContaining({
          cwd: '/tmp/worktree',
        })
      );

      // Check that body contains PR info
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('PR Ready');
      expect(body).toContain('456');
      expect(body).toContain('https://github.com/test-owner/test-repo/pull/456');
    });

    it('should include summary in the notification', async () => {
      mockSuccessfulSpawn();

      await notifyPRReady({
        ...baseOptions,
        prUrl: 'https://github.com/test-owner/test-repo/pull/456',
        prNumber: 456,
        summary: 'Implemented feature X with full test coverage',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Implemented feature X with full test coverage');
    });

    it('should return error on failure', async () => {
      mockFailedSpawn('error: could not post comment');

      const result = await notifyPRReady({
        ...baseOptions,
        prUrl: 'https://github.com/test-owner/test-repo/pull/456',
        prNumber: 456,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to post comment');
    });
  });

  describe('notifyImplementationStuck', () => {
    it('should post stuck comment successfully', async () => {
      mockSuccessfulSpawn();

      const result = await notifyImplementationStuck({
        ...baseOptions,
        reason: 'Tests failing after 3 attempts',
        iteration: 5,
        worktreePath: '/path/to/worktree',
      });

      expect(result.success).toBe(true);
    });

    it('should include reason in the notification', async () => {
      mockSuccessfulSpawn();

      await notifyImplementationStuck({
        ...baseOptions,
        reason: 'Cannot resolve dependency conflict',
        worktreePath: '/path/to/worktree',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Implementation Stuck');
      expect(body).toContain('Cannot resolve dependency conflict');
    });

    it('should include iteration number when provided', async () => {
      mockSuccessfulSpawn();

      await notifyImplementationStuck({
        ...baseOptions,
        reason: 'Build failing',
        iteration: 3,
        worktreePath: '/path/to/worktree',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Iteration');
      expect(body).toContain('3');
    });

    it('should include worktree path in the notification', async () => {
      mockSuccessfulSpawn();

      await notifyImplementationStuck({
        ...baseOptions,
        reason: 'Stuck',
        worktreePath: '/home/user/worktrees/issue-123',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('/home/user/worktrees/issue-123');
    });

    it('should include next steps guidance', async () => {
      mockSuccessfulSpawn();

      await notifyImplementationStuck({
        ...baseOptions,
        reason: 'Stuck',
        worktreePath: '/path/to/worktree',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Next Steps');
    });
  });

  describe('notifyReviewStuck', () => {
    it('should post review stuck comment successfully', async () => {
      mockSuccessfulSpawn();

      const result = await notifyReviewStuck({
        ...baseOptions,
        reviewCycle: 3,
        lastFeedback: 'Tests still failing',
      });

      expect(result.success).toBe(true);
    });

    it('should include review cycle count', async () => {
      mockSuccessfulSpawn();

      await notifyReviewStuck({
        ...baseOptions,
        reviewCycle: 3,
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Review Cycle Stuck');
      expect(body).toContain('3');
    });

    it('should include last feedback when provided', async () => {
      mockSuccessfulSpawn();

      await notifyReviewStuck({
        ...baseOptions,
        reviewCycle: 2,
        lastFeedback: 'Missing error handling in the API endpoint',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Last Review Feedback');
      expect(body).toContain('Missing error handling in the API endpoint');
    });

    it('should include guidance for manual intervention', async () => {
      mockSuccessfulSpawn();

      await notifyReviewStuck({
        ...baseOptions,
        reviewCycle: 3,
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('Next Steps');
      expect(body).toContain('human');
    });
  });

  describe('error handling', () => {
    it('should handle spawn error gracefully', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('gh: command not found')), 10);
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await notifyPRReady({
        ...baseOptions,
        prUrl: 'https://github.com/test-owner/test-repo/pull/456',
        prNumber: 456,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to run gh CLI');
    });

    it('should handle empty stderr on failure', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            setTimeout(() => handler(1), 10);
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await notifyImplementationStuck({
        ...baseOptions,
        reason: 'Stuck',
        worktreePath: '/path',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown error');
    });
  });

  describe('notification formatting', () => {
    it('should include PPDS attribution in all notifications', async () => {
      mockSuccessfulSpawn();

      await notifyPRReady({
        ...baseOptions,
        prUrl: 'https://github.com/test-owner/test-repo/pull/456',
        prNumber: 456,
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const bodyIndex = args.indexOf('--body') + 1;
      const body = args[bodyIndex];

      expect(body).toContain('PPDS Orchestration');
    });
  });
});
