import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  expandPath,
  centralConfigExists,
  loadCentralConfig,
  saveCentralConfig,
  getRepoEffectiveConfig,
  getPromptHooks,
  createDefaultConfig,
} from './config-loader.js';
import type { CentralConfig, HookConfig } from './central-config.js';

describe('config-loader', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-loader-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('expandPath', () => {
    it('expands ~ to home directory', () => {
      const expanded = expandPath('~/config.json');
      expect(expanded).toBe(path.join(os.homedir(), 'config.json'));
    });

    it('expands ~ with nested path', () => {
      const expanded = expandPath('~/.orchestration/config.json');
      expect(expanded).toBe(
        path.join(os.homedir(), '.orchestration', 'config.json')
      );
    });

    it('leaves absolute paths unchanged', () => {
      const absolutePath = '/absolute/path/config.json';
      expect(expandPath(absolutePath)).toBe(absolutePath);
    });

    it('leaves relative paths unchanged', () => {
      const relativePath = './relative/config.json';
      expect(expandPath(relativePath)).toBe(relativePath);
    });
  });

  describe('centralConfigExists', () => {
    it('returns true when config file exists', () => {
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, '{}');

      expect(centralConfigExists(configPath)).toBe(true);
    });

    it('returns false when config file does not exist', () => {
      const configPath = path.join(tempDir, 'nonexistent.json');
      expect(centralConfigExists(configPath)).toBe(false);
    });
  });

  describe('loadCentralConfig', () => {
    it('throws when config does not exist', () => {
      const configPath = path.join(tempDir, 'nonexistent.json');
      expect(() => loadCentralConfig(configPath)).toThrow(/not found/);
    });

    it('parses valid config', () => {
      const validConfig: CentralConfig = {
        version: '1.0',
        repos: {
          'test-repo': {
            path: '/path/to/repo',
            githubOwner: 'owner',
            githubRepo: 'repo',
          },
        },
        cliCommand: 'orch',
      };

      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify(validConfig));

      const config = loadCentralConfig(configPath);
      expect(config.repos['test-repo'].path).toBe('/path/to/repo');
      expect(config.cliCommand).toBe('orch');
    });

    it('throws on invalid JSON', () => {
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, 'not valid json');

      expect(() => loadCentralConfig(configPath)).toThrow();
    });

    it('throws on invalid schema', () => {
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ invalid: 'schema' }));

      expect(() => loadCentralConfig(configPath)).toThrow(/Invalid/);
    });
  });

  describe('saveCentralConfig', () => {
    it('saves config to file', () => {
      const config = createDefaultConfig();
      const configPath = path.join(tempDir, 'output.json');

      saveCentralConfig(config, configPath);

      expect(fs.existsSync(configPath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.version).toBe('1.0');
    });

    it('creates parent directories', () => {
      const config = createDefaultConfig();
      const configPath = path.join(tempDir, 'nested', 'dir', 'config.json');

      saveCentralConfig(config, configPath);

      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('overwrites existing file', () => {
      const configPath = path.join(tempDir, 'config.json');
      fs.writeFileSync(configPath, '{}');

      const config = createDefaultConfig();
      saveCentralConfig(config, configPath);

      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(saved.version).toBe('1.0');
    });
  });

  describe('getRepoEffectiveConfig', () => {
    const baseConfig: CentralConfig = {
      version: '1.0',
      repos: {
        'test-repo': {
          path: '/path/to/repo',
        },
      },
      hooks: {
        onSpawn: { type: 'command', value: 'global-spawn' },
        onStuck: { type: 'prompt', value: 'global stuck prompt' },
      },
      cliCommand: 'orch',
    };

    it('throws for non-existent repo', () => {
      expect(() =>
        getRepoEffectiveConfig(baseConfig, 'nonexistent')
      ).toThrow(/not found/);
    });

    it('returns repo config', () => {
      const effective = getRepoEffectiveConfig(baseConfig, 'test-repo');
      expect(effective.repoConfig.path).toBe('/path/to/repo');
    });

    it('inherits global CLI command', () => {
      const effective = getRepoEffectiveConfig(baseConfig, 'test-repo');
      expect(effective.cliCommand).toBe('orch');
    });

    it('repo CLI command overrides global', () => {
      const config: CentralConfig = {
        ...baseConfig,
        repos: {
          'test-repo': {
            path: '/path',
            cliCommand: 'custom-cli',
          },
        },
      };

      const effective = getRepoEffectiveConfig(config, 'test-repo');
      expect(effective.cliCommand).toBe('custom-cli');
    });

    it('includes global hooks', () => {
      const effective = getRepoEffectiveConfig(baseConfig, 'test-repo');
      expect(effective.hooks['onSpawn']).toEqual({
        type: 'command',
        value: 'global-spawn',
      });
      expect(effective.hooks['onStuck']).toEqual({
        type: 'prompt',
        value: 'global stuck prompt',
      });
    });

    it('repo hooks override global hooks', () => {
      const config: CentralConfig = {
        ...baseConfig,
        repos: {
          'test-repo': {
            path: '/path',
            hooks: {
              onSpawn: { type: 'command', value: 'repo-spawn' },
            },
          },
        },
      };

      const effective = getRepoEffectiveConfig(config, 'test-repo');

      // Repo override wins
      expect(effective.hooks['onSpawn'].value).toBe('repo-spawn');
      // Global hook still included
      expect(effective.hooks['onStuck'].value).toBe('global stuck prompt');
    });

    it('provides default ralph config', () => {
      const configWithoutRalph: CentralConfig = {
        version: '1.0',
        repos: { 'test-repo': { path: '/path' } },
        cliCommand: 'orch',
      };

      const effective = getRepoEffectiveConfig(configWithoutRalph, 'test-repo');
      expect(effective.ralph.maxIterations).toBe(10);
      expect(effective.ralph.iterationDelayMs).toBe(5000);
    });
  });

  describe('getPromptHooks', () => {
    it('returns empty array when no hooks match', () => {
      const hooks: Record<string, HookConfig> = {};
      const prompts = getPromptHooks(hooks, ['onSpawn', 'onTest']);
      expect(prompts).toEqual([]);
    });

    it('returns prompt values for prompt-type hooks', () => {
      const hooks: Record<string, HookConfig> = {
        onSpawn: { type: 'prompt', value: 'spawn prompt' },
        onTest: { type: 'prompt', value: 'test prompt' },
      };
      const prompts = getPromptHooks(hooks, ['onSpawn', 'onTest']);
      expect(prompts).toEqual(['spawn prompt', 'test prompt']);
    });

    it('ignores command-type hooks', () => {
      const hooks: Record<string, HookConfig> = {
        onSpawn: { type: 'command', value: 'echo hello' },
        onTest: { type: 'prompt', value: 'test prompt' },
      };
      const prompts = getPromptHooks(hooks, ['onSpawn', 'onTest']);
      expect(prompts).toEqual(['test prompt']);
    });

    it('only includes requested hook names', () => {
      const hooks: Record<string, HookConfig> = {
        onSpawn: { type: 'prompt', value: 'spawn prompt' },
        onTest: { type: 'prompt', value: 'test prompt' },
        onStuck: { type: 'prompt', value: 'stuck prompt' },
      };
      const prompts = getPromptHooks(hooks, ['onSpawn']);
      expect(prompts).toEqual(['spawn prompt']);
    });
  });

  describe('createDefaultConfig', () => {
    it('creates config with expected structure', () => {
      const config = createDefaultConfig();

      expect(config.version).toBe('1.0');
      expect(config.repos).toEqual({});
      expect(config.cliCommand).toBe('orch');
    });

    it('includes ralph defaults', () => {
      const config = createDefaultConfig();

      expect(config.ralph?.maxIterations).toBe(10);
      expect(config.ralph?.iterationDelayMs).toBe(5000);
      expect(config.ralph?.doneSignal).toEqual({
        type: 'file',
        value: '.claude/.ralph-done',
      });
    });

    it('includes dashboard defaults', () => {
      const config = createDefaultConfig();

      expect(config.dashboard?.port).toBe(3847);
    });
  });
});
