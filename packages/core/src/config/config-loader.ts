import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CentralConfig, RepoConfig, HookConfig, HookConfigInput } from './central-config.js';

/**
 * Environment variable for custom config path.
 * Set this to use a config file in a custom location (e.g., for version-controlled configs).
 */
export const CONFIG_PATH_ENV_VAR = 'ORCH_CONFIG_PATH';

/**
 * Default location for central config file.
 */
export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.orchestration', 'config.json');

/**
 * Get the effective config path, checking env var first.
 */
export function getConfigPath(): string {
  return process.env[CONFIG_PATH_ENV_VAR] || DEFAULT_CONFIG_PATH;
}

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
 * @param configPath Path to config file (defaults to ORCH_CONFIG_PATH env var or ~/.orchestration/config.json)
 * @returns Validated central config
 * @throws If config file doesn't exist or is invalid
 */
export function loadCentralConfig(configPath: string = getConfigPath()): CentralConfig {
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
 * @param configPath Path to save to (defaults to ORCH_CONFIG_PATH env var or ~/.orchestration/config.json)
 */
export function saveCentralConfig(config: CentralConfig, configPath: string = getConfigPath()): void {
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
export function centralConfigExists(configPath: string = getConfigPath()): boolean {
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
    maxIterations: 10,
    promise: { type: 'plan_complete' as const, value: 'IMPLEMENTATION_PLAN.md' },
    gitOperations: { commitAfterEach: true, pushAfterEach: true, createPrOnComplete: true },
    doneSignal: { type: 'file' as const, value: '.claude/.ralph-done' },
    iterationDelayMs: 5000,
    spawner: { type: 'windows-terminal' as const, usePty: false, docker: { image: 'ppds-worker:latest', memoryLimit: '4g', cpuLimit: '2', volumes: [], env: {} } },
    reviewConfig: { maxCycles: 3, timeoutMs: 300_000 },
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
      maxIterations: 10,
      promise: { type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' },
      gitOperations: { commitAfterEach: true, pushAfterEach: true, createPrOnComplete: true },
      doneSignal: { type: 'file', value: '.claude/.ralph-done' },
      iterationDelayMs: 5000,
      spawner: { type: 'windows-terminal', usePty: false, docker: { image: 'ppds-worker:latest', memoryLimit: '4g', cpuLimit: '2', volumes: [], env: {} } },
      reviewConfig: { maxCycles: 3, timeoutMs: 300_000 },
    },
    dashboard: {
      port: 3847,
    },
    cliCommand: 'orch',
  };
}
