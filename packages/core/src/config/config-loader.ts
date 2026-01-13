import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CentralConfig, RepoConfig, HookConfig, HookConfigInput } from './central-config.js';

/**
 * Default location for central config file.
 */
export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.orchestration', 'config.json');

/**
 * Expands ~ to home directory in paths.
 */
export function expandPath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

/**
 * Load and validate central config from disk.
 * @param configPath Path to config file (defaults to ~/.orchestration/config.json)
 * @returns Validated central config
 * @throws If config file doesn't exist or is invalid
 */
export function loadCentralConfig(configPath: string = DEFAULT_CONFIG_PATH): CentralConfig {
  const expandedPath = expandPath(configPath);

  if (!fs.existsSync(expandedPath)) {
    throw new Error(`Central config not found at ${expandedPath}. Run 'orch init' to create one.`);
  }

  const content = fs.readFileSync(expandedPath, 'utf-8');
  const json = JSON.parse(content);

  // Validate with Zod
  const result = CentralConfig.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid central config: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Save central config to disk.
 * @param config Config to save
 * @param configPath Path to save to (defaults to ~/.orchestration/config.json)
 */
export function saveCentralConfig(config: CentralConfig, configPath: string = DEFAULT_CONFIG_PATH): void {
  const expandedPath = expandPath(configPath);
  const dir = path.dirname(expandedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(expandedPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Check if central config exists.
 */
export function centralConfigExists(configPath: string = DEFAULT_CONFIG_PATH): boolean {
  return fs.existsSync(expandPath(configPath));
}

/**
 * Get effective config for a repo (global + repo overrides).
 */
export function getRepoEffectiveConfig(
  centralConfig: CentralConfig,
  repoId: string
): {
  repoConfig: RepoConfig;
  cliCommand: string;
  hooks: Record<string, HookConfig>;
  ralph: NonNullable<CentralConfig['ralph']>;
} {
  const repoConfig = centralConfig.repos[repoId];
  if (!repoConfig) {
    throw new Error(`Repo '${repoId}' not found in central config`);
  }

  // Merge CLI command (repo override > global)
  const cliCommand = repoConfig.cliCommand ?? centralConfig.cliCommand;

  // Merge hooks (repo overrides global)
  const hooks: Record<string, HookConfig> = {};

  // Add global hooks
  if (centralConfig.hooks) {
    for (const [key, value] of Object.entries(centralConfig.hooks)) {
      if (value) {
        hooks[key] = normalizeHook(value);
      }
    }
  }

  // Override with repo-specific hooks
  if (repoConfig.hooks) {
    for (const [key, value] of Object.entries(repoConfig.hooks)) {
      hooks[key] = normalizeHook(value);
    }
  }

  // Get ralph config with defaults
  const ralph = centralConfig.ralph ?? {
    defaultIterations: 10,
    doneSignal: { type: 'file' as const, value: '.claude/.ralph-done' },
    iterationDelayMs: 5000,
  };

  return { repoConfig, cliCommand, hooks, ralph };
}

/**
 * Normalize hook config input to HookConfig.
 */
function normalizeHook(input: HookConfigInput): HookConfig {
  if (typeof input === 'string') {
    return {
      type: input.startsWith('/') ? 'command' : 'prompt',
      value: input,
    };
  }
  return input;
}

/**
 * Get all prompt hooks for a given lifecycle point.
 * Returns array of prompt text to inject into worker prompt.
 */
export function getPromptHooks(
  effectiveHooks: Record<string, HookConfig>,
  hookNames: string[]
): string[] {
  const prompts: string[] = [];

  for (const name of hookNames) {
    const hook = effectiveHooks[name];
    if (hook && hook.type === 'prompt') {
      prompts.push(hook.value);
    }
  }

  return prompts;
}

/**
 * Create a minimal default config.
 */
export function createDefaultConfig(): CentralConfig {
  return {
    version: '1.0',
    repos: {},
    hooks: {},
    ralph: {
      defaultIterations: 10,
      doneSignal: { type: 'file', value: '.claude/.ralph-done' },
      iterationDelayMs: 5000,
    },
    dashboard: {
      port: 3847,
    },
    cliCommand: 'orch',
  };
}
