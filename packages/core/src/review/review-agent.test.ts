import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeReviewAgent, type ReviewAgentOptions } from './review-agent.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

describe('invokeReviewAgent', () => {
  const mockOptions: ReviewAgentOptions = {
    worktreePath: '/tmp/worktree',
    githubOwner: 'test-owner',
    githubRepo: 'test-repo',
    issueNumber: 1,
    timeoutMs: 5000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful review', () => {
    it('should return APPROVED verdict when agent approves', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from(`
Some review output...

\`\`\`json
{
  "status": "APPROVED",
  "summary": "Code looks good",
  "confidence": 95
}
\`\`\`

Done reviewing.
              `));
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
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.success).toBe(true);
      expect(result.verdict?.status).toBe('APPROVED');
      expect(result.verdict?.summary).toBe('Code looks good');
      expect(result.verdict?.confidence).toBe(95);
    });

    it('should return NEEDS_WORK verdict when agent requests changes', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from(`
\`\`\`json
{
  "status": "NEEDS_WORK",
  "summary": "Tests failing",
  "feedback": "Please fix the unit tests"
}
\`\`\`
              `));
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
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.success).toBe(true);
      expect(result.verdict?.status).toBe('NEEDS_WORK');
      expect(result.verdict?.feedback).toBe('Please fix the unit tests');
    });

    it('should parse raw JSON without code fence', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from(`{"status": "APPROVED", "summary": "Looks good"}`));
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
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.success).toBe(true);
      expect(result.verdict?.status).toBe('APPROVED');
    });
  });

  describe('error handling', () => {
    it('should return error when process exits with non-zero code', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('claude: command not found'));
            }
          }),
        },
        on: vi.fn((event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            setTimeout(() => handler(1), 10);
          }
        }),
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });

    it('should return error when process spawn fails', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('spawn ENOENT')), 10);
          }
        }),
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn');
    });

    it('should return error when JSON parsing fails', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('This is not JSON at all'));
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
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse');
    });
  });

  describe('timeout handling', () => {
    it('should timeout and return error when agent takes too long', async () => {
      vi.useFakeTimers();

      const mockProcess = {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn(), // Never calls handlers
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const resultPromise = invokeReviewAgent({
        ...mockOptions,
        timeoutMs: 1000,
      });

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(1100);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(mockProcess.kill).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('spawning claude CLI', () => {
    it('should spawn claude with correct arguments', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('{"status": "APPROVED", "summary": "OK"}'));
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
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      await invokeReviewAgent(mockOptions);

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--dangerously-skip-permissions']),
        expect.objectContaining({
          cwd: mockOptions.worktreePath,
        })
      );
    });

    it('should include context in the prompt', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('{"status": "APPROVED", "summary": "OK"}'));
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
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      await invokeReviewAgent(mockOptions);

      // Check that the prompt includes context
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      const prompt = args[args.length - 1]; // Last arg is the prompt

      expect(prompt).toContain('test-owner/test-repo');
      expect(prompt).toContain('#1');
    });
  });

  describe('duration tracking', () => {
    it('should track execution duration', async () => {
      const mockProcess = {
        stdout: {
          on: vi.fn((event: string, handler: (data: Buffer) => void) => {
            if (event === 'data') {
              handler(Buffer.from('{"status": "APPROVED", "summary": "OK"}'));
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            setTimeout(() => handler(0), 50);
          }
        }),
        kill: vi.fn(),
      };

      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await invokeReviewAgent(mockOptions);

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    });
  });
});
