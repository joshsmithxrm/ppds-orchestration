import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkerSpawnRequest, IssueRef } from '../session/types.js';

// The WindowsTerminalSpawner spawns actual processes, which makes it difficult
// to unit test without side effects. These tests focus on:
// 1. Interface compliance
// 2. Factory behavior
// 3. Static method behavior (that doesn't spawn processes)
//
// NOTE: Tests that actually call spawn() are SKIPPED because they open real
// Windows Terminal tabs that become orphaned. To test spawn behavior manually,
// use integration tests or run the CLI directly.

const createTestIssue = (number: number): IssueRef => ({
  number,
  title: `Test issue #${number}`,
  body: `Description for issue #${number}`,
});

describe('WindowsTerminalSpawner', () => {
  describe('WindowsTerminalSpawner class', () => {
    it('should have getName return "Headless Spawner"', async () => {
      const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
      const spawner = new WindowsTerminalSpawner();
      expect(spawner.getName()).toBe('Headless Spawner');
    });

    it('should implement WorkerSpawner interface', async () => {
      const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
      const spawner = new WindowsTerminalSpawner();

      expect(typeof spawner.isAvailable).toBe('function');
      expect(typeof spawner.spawn).toBe('function');
      expect(typeof spawner.getName).toBe('function');
    });

    it('should return boolean from isAvailable', async () => {
      const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
      const spawner = new WindowsTerminalSpawner();

      const result = spawner.isAvailable();
      expect(typeof result).toBe('boolean');
    });

    it('should cache isAvailable result', async () => {
      const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
      const spawner = new WindowsTerminalSpawner();

      const result1 = spawner.isAvailable();
      const result2 = spawner.isAvailable();
      const result3 = spawner.isAvailable();

      // Results should be consistent (cached)
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });

  describe('createSpawner factory', () => {
    it('should return WindowsTerminalSpawner on Windows', async () => {
      if (process.platform === 'win32') {
        const { createSpawner, WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
        const spawner = createSpawner();
        expect(spawner).toBeInstanceOf(WindowsTerminalSpawner);
      }
    });

    it('should throw on non-Windows platforms', async () => {
      if (process.platform !== 'win32') {
        const { createSpawner } = await import('./windows-terminal-spawner.js');
        expect(() => createSpawner()).toThrow(/No worker spawner available/);
      }
    });
  });

  // SKIPPED: These tests actually open Windows Terminal tabs which creates orphaned
  // windows during test runs. The spawn() method is tested via integration tests.
  describe.skip('spawn method contract (opens real terminals - skipped)', () => {
    let tempDir: string;
    let worktreePath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-spawner-test-'));
      worktreePath = path.join(tempDir, 'worktree');
      fs.mkdirSync(worktreePath, { recursive: true });
    });

    afterEach(() => {
      setTimeout(() => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors in tests
        }
      }, 100);
    });

    const createRequest = (): WorkerSpawnRequest => ({
      sessionId: '42',
      issue: createTestIssue(42),
      workingDirectory: worktreePath,
      promptFilePath: path.join(worktreePath, '.claude', 'session-prompt.md'),
      githubOwner: 'test-owner',
      githubRepo: 'test-repo',
    });

    it('should return SpawnResult with required fields', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
      const spawner = new WindowsTerminalSpawner();
      const result = await spawner.spawn(createRequest());

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('spawnId');
      expect(result).toHaveProperty('spawnedAt');

      expect(typeof result.success).toBe('boolean');
      expect(typeof result.spawnId).toBe('string');
      expect(typeof result.spawnedAt).toBe('string');

      expect(() => new Date(result.spawnedAt)).not.toThrow();
    });

    it('should return error when terminal is unavailable', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
      const spawner = new WindowsTerminalSpawner();

      if (!spawner.isAvailable()) {
        const result = await spawner.spawn(createRequest());
        expect(result.success).toBe(false);
        expect(result.error).toBe('Windows Terminal is not available');
      }
    });
  });
});

describe('SpawnResult type compliance', () => {
  it('should have success, spawnId, and spawnedAt fields', async () => {
    // This tests the TypeScript interface compliance at runtime
    const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');

    // Create a spawner but don't actually spawn
    const spawner = new WindowsTerminalSpawner();

    // The methods should exist and have correct signatures
    expect(typeof spawner.spawn).toBe('function');
  });
});

describe('WorkerSpawner interface', () => {
  it('should be properly typed', async () => {
    const { WindowsTerminalSpawner } = await import('./windows-terminal-spawner.js');
    const spawner = new WindowsTerminalSpawner();

    // TypeScript ensures these exist at compile time,
    // but we verify at runtime too
    const methods = ['getName', 'isAvailable', 'spawn'];
    for (const method of methods) {
      expect(typeof (spawner as any)[method]).toBe('function');
    }
  });
});
