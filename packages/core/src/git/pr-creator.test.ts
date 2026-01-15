import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPullRequest, generatePRBody, type CreatePROptions } from './pr-creator.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

describe('createPullRequest', () => {
  const mockOptions: CreatePROptions = {
    cwd: '/tmp/worktree',
    githubOwner: 'test-owner',
    githubRepo: 'test-repo',
    title: 'feat: Add new feature',
    body: 'This PR adds a new feature.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful PR creation', () => {
    it('should create PR and return URL', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('https://github.com/test-owner/test-repo/pull/123\n'));
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

      const result = await createPullRequest(mockOptions);

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://github.com/test-owner/test-repo/pull/123');
      expect(result.number).toBe(123);
    });

    it('should call gh pr create with correct arguments', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('https://github.com/test-owner/test-repo/pull/1'));
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

      await createPullRequest(mockOptions);

      expect(spawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'pr', 'create',
          '--repo', 'test-owner/test-repo',
          '--title', 'feat: Add new feature',
          '--body', 'This PR adds a new feature.',
        ]),
        expect.objectContaining({
          cwd: '/tmp/worktree',
        })
      );
    });

    it('should include base branch when specified', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('https://github.com/test-owner/test-repo/pull/1'));
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

      await createPullRequest({
        ...mockOptions,
        baseBranch: 'develop',
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];

      expect(args).toContain('--base');
      expect(args).toContain('develop');
    });

    it('should include draft flag when specified', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('https://github.com/test-owner/test-repo/pull/1'));
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

      await createPullRequest({
        ...mockOptions,
        draft: true,
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];

      expect(args).toContain('--draft');
    });

    it('should include labels when specified', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('https://github.com/test-owner/test-repo/pull/1'));
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

      await createPullRequest({
        ...mockOptions,
        labels: ['enhancement', 'ready-for-review'],
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];

      expect(args).toContain('--label');
      expect(args).toContain('enhancement');
      expect(args).toContain('ready-for-review');
    });
  });

  describe('error handling', () => {
    it('should return error when gh CLI fails', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('error: could not create pull request'));
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

      const result = await createPullRequest(mockOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to create PR');
    });

    it('should return error when spawn fails', async () => {
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

      const result = await createPullRequest(mockOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to run gh CLI');
    });

    it('should handle missing PR number in URL gracefully', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              // Unusual URL format without PR number
              handler(Buffer.from('https://github.com/test-owner/test-repo/something'));
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

      const result = await createPullRequest(mockOptions);

      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.number).toBeUndefined();
    });
  });
});

describe('generatePRBody', () => {
  it('should generate basic PR body with issue reference', () => {
    const body = generatePRBody({
      issueNumber: 123,
      issueTitle: 'Add new feature',
    });

    expect(body).toContain('Summary');
    expect(body).toContain('Closes #123');
    expect(body).toContain('Add new feature');
  });

  it('should include summary when provided', () => {
    const body = generatePRBody({
      issueNumber: 123,
      issueTitle: 'Add new feature',
      summary: 'This implements the new feature with full test coverage',
    });

    expect(body).toContain('This implements the new feature with full test coverage');
  });

  it('should include test plan when provided', () => {
    const body = generatePRBody({
      issueNumber: 123,
      issueTitle: 'Add new feature',
      testPlan: '- [ ] Unit tests\n- [ ] Integration tests',
    });

    expect(body).toContain('Test Plan');
    expect(body).toContain('Unit tests');
    expect(body).toContain('Integration tests');
  });

  it('should include PPDS attribution', () => {
    const body = generatePRBody({
      issueNumber: 123,
      issueTitle: 'Add new feature',
    });

    expect(body).toContain('PPDS');
  });
});
