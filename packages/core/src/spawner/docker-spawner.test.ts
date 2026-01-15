import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerSpawner } from './docker-spawner.js';
import type { WorkerSpawnRequest } from '../session/types.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { spawn, spawnSync } from 'node:child_process';

describe('DockerSpawner', () => {
  let spawner: DockerSpawner;

  const createMockRequest = (overrides: Partial<WorkerSpawnRequest> = {}): WorkerSpawnRequest => ({
    sessionId: 'test-session',
    issue: { number: 1, title: 'Test Issue' },
    workingDirectory: '/tmp/worktree',
    promptFilePath: '/tmp/worktree/.claude/session-prompt.md',
    githubOwner: 'test-owner',
    githubRepo: 'test-repo',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    spawner = new DockerSpawner();
  });

  describe('isAvailable', () => {
    it('should return true when docker is available', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: Buffer.from('Docker version 24.0.0'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      expect(spawner.isAvailable()).toBe(true);
      expect(spawnSync).toHaveBeenCalledWith('docker', ['--version'], expect.any(Object));
    });

    it('should return false when docker is not available', () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('command not found'),
        pid: 1234,
        signal: null,
        output: [],
      });

      expect(spawner.isAvailable()).toBe(false);
    });

    it('should return false when spawnSync throws', () => {
      vi.mocked(spawnSync).mockImplementation(() => {
        throw new Error('spawn failed');
      });

      expect(spawner.isAvailable()).toBe(false);
    });
  });

  describe('getName', () => {
    it('should return "Docker Spawner"', () => {
      expect(spawner.getName()).toBe('Docker Spawner');
    });
  });

  describe('spawn', () => {
    it('should return error when docker is not available', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      const result = await spawner.spawn(createMockRequest());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Docker is not available');
    });

    it('should spawn docker container with correct args', async () => {
      // Mock isAvailable to return true
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('Docker version 24.0.0'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      // Mock the docker ps call to get container ID
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('abc123'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      // Mock spawn to simulate successful container start
      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'close') {
            // Simulate successful close
            setTimeout(() => handler(0), 10);
          }
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const request = createMockRequest();
      const result = await spawner.spawn(request);

      expect(result.success).toBe(true);
      expect(result.spawnId).toBeDefined();
      expect(result.spawnedAt).toBeDefined();

      // Verify spawn was called with docker run command
      expect(spawn).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining([
          'run',
          '--rm',
          '--cap-drop', 'ALL',
          '--pids-limit', '100',
          '--security-opt', 'no-new-privileges',
        ]),
        expect.any(Object)
      );
    });

    it('should include security hardening args', async () => {
      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('Docker version 24.0.0'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('abc123'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 10);
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      await spawner.spawn(createMockRequest());

      // Verify security hardening args
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];

      expect(args).toContain('--cap-drop');
      expect(args).toContain('ALL');
      expect(args).toContain('--pids-limit');
      expect(args).toContain('100');
      expect(args).toContain('--security-opt');
      expect(args).toContain('no-new-privileges');
    });

    it('should handle spawn error', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: Buffer.from('Docker version 24.0.0'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('spawn failed')), 10);
          }
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await spawner.spawn(createMockRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to start Docker');
    });
  });

  describe('stop', () => {
    it('should call docker stop with container ID', async () => {
      // First, spawn a container to track it
      vi.mocked(spawnSync)
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('Docker version'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('container123'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 10);
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await spawner.spawn(createMockRequest());
      expect(result.success).toBe(true);

      // Now test stop
      const stopMockProcess = {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'close') setTimeout(handler, 10);
        }),
      };
      vi.mocked(spawn).mockReturnValue(stopMockProcess as unknown as ReturnType<typeof spawn>);

      await spawner.stop(result.spawnId);

      // Verify docker stop was called
      expect(spawn).toHaveBeenCalledWith(
        'docker',
        ['stop', '-t', '10', 'container123'],
        expect.any(Object)
      );
    });

    it('should handle unknown spawnId gracefully', async () => {
      // Should not throw
      await expect(spawner.stop('unknown-id')).resolves.toBeUndefined();
    });
  });

  describe('getStatus', () => {
    it('should return not running for unknown spawnId', async () => {
      const status = await spawner.getStatus('unknown-id');

      expect(status.running).toBe(false);
      expect(status.exitCode).toBeUndefined();
    });

    it('should return running status from docker inspect', async () => {
      // First spawn a container
      vi.mocked(spawnSync)
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('Docker version'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('container123'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 10);
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await spawner.spawn(createMockRequest());

      // Mock docker inspect to return running=true
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        stdout: Buffer.from('true'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      const status = await spawner.getStatus(result.spawnId);

      expect(status.running).toBe(true);
    });

    it('should return exit code when container is not running', async () => {
      // First spawn a container
      vi.mocked(spawnSync)
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('Docker version'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('container123'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 10);
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      const result = await spawner.spawn(createMockRequest());

      // Mock docker inspect to return running=false
      vi.mocked(spawnSync)
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('false'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: Buffer.from('0'),
          stderr: Buffer.from(''),
          pid: 1234,
          signal: null,
          output: [],
        });

      const status = await spawner.getStatus(result.spawnId);

      expect(status.running).toBe(false);
      expect(status.exitCode).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should use default config values', () => {
      const defaultSpawner = new DockerSpawner();
      expect(defaultSpawner.getName()).toBe('Docker Spawner');
    });

    it('should use custom config values', async () => {
      const customSpawner = new DockerSpawner({
        image: 'custom-image:v1',
        memoryLimit: '8g',
        cpuLimit: '4',
      });

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('Docker version'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      vi.mocked(spawnSync).mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('container123'),
        stderr: Buffer.from(''),
        pid: 1234,
        signal: null,
        output: [],
      });

      const mockProcess = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
          if (event === 'close') setTimeout(() => handler(0), 10);
        }),
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      await customSpawner.spawn(createMockRequest());

      // Verify custom config was used
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];

      expect(args).toContain('custom-image:v1');
      expect(args).toContain('8g');
      expect(args).toContain('4');
    });
  });
});
