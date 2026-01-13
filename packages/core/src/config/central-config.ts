import { z } from 'zod';

/**
 * Hook configuration for lifecycle events.
 * Command hooks execute shell commands; prompt hooks inject text into worker prompts.
 */
export const HookConfig = z.object({
  /** Hook type: 'command' runs shell command, 'prompt' injects into worker prompt */
  type: z.enum(['command', 'prompt']),
  /** For command: shell command to execute. For prompt: text to inject */
  value: z.string(),
});

export type HookConfig = z.infer<typeof HookConfig>;

/**
 * Shorthand hook format - just a string that gets parsed into HookConfig.
 * Strings starting with '/' are commands, others are prompts.
 */
export const HookConfigInput = z.union([
  HookConfig,
  z.string().transform((val): z.infer<typeof HookConfig> => ({
    type: val.startsWith('/') ? 'command' : 'prompt',
    value: val,
  })),
]);

export type HookConfigInput = z.input<typeof HookConfigInput>;

/**
 * Global hook definitions that apply to all repos unless overridden.
 */
export const GlobalHooks = z.object({
  /** Before spawning a worker */
  onSpawn: HookConfigInput.optional(),
  /** When worker gets stuck */
  onStuck: HookConfigInput.optional(),
  /** After PR is created */
  onShip: HookConfigInput.optional(),
  /** When worker completes successfully */
  onComplete: HookConfigInput.optional(),
  /** Before running tests (prompt hook recommended) */
  onTest: HookConfigInput.optional(),
  /** On each Ralph iteration */
  onRalphIteration: HookConfigInput.optional(),
});

export type GlobalHooks = z.infer<typeof GlobalHooks>;

/**
 * Per-repository configuration.
 */
export const RepoConfig = z.object({
  /** Absolute path to the repo root */
  path: z.string(),
  /** GitHub owner/org (optional, detected from git remote if not set) */
  githubOwner: z.string().optional(),
  /** GitHub repo name (optional, detected from git remote if not set) */
  githubRepo: z.string().optional(),
  /** Base branch for worktrees (default: origin/main) */
  baseBranch: z.string().optional(),
  /** Worktree directory root (default: parent of repo) */
  worktreeRoot: z.string().optional(),
  /** Prefix for worktree directory names */
  worktreePrefix: z.string().optional(),
  /** Default execution mode for this repo */
  defaultMode: z.enum(['single', 'ralph']).optional(),
  /** CLI command for workers to use (overrides global) */
  cliCommand: z.string().optional(),
  /** Per-repo hook overrides */
  hooks: z.record(z.string(), HookConfigInput).optional(),
});

export type RepoConfig = z.infer<typeof RepoConfig>;

/**
 * Ralph loop done signal configuration.
 */
export const DoneSignalConfig = z.object({
  /** Type of done detection */
  type: z.enum(['status', 'file', 'exit_code']),
  /**
   * For status: the status value indicating done (e.g., 'complete')
   * For file: path relative to worktree to check for
   * For exit_code: expected exit code as string (e.g., '0')
   */
  value: z.string(),
});

export type DoneSignalConfig = z.infer<typeof DoneSignalConfig>;

/**
 * Ralph loop execution settings.
 */
export const RalphConfig = z.object({
  /** Maximum iterations before giving up (default: 10) */
  maxIterations: z.number().default(10),
  /** Signal indicating Ralph is done */
  doneSignal: DoneSignalConfig.default({ type: 'status', value: 'complete' }),
  /** Delay between iterations in ms (default: 5000) */
  iterationDelayMs: z.number().default(5000),
});

export type RalphConfig = z.infer<typeof RalphConfig>;

/**
 * Dashboard settings.
 */
export const DashboardConfig = z.object({
  /** Port for web server (default: 3847) */
  port: z.number().default(3847),
});

export type DashboardConfig = z.infer<typeof DashboardConfig>;

/**
 * Sound effect configuration (optional).
 */
export const SoundsConfig = z.object({
  /** Whether sounds are enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Base directory for sound files (served via /api/sounds) */
  soundsDir: z.string().optional(),
  /** Sound URL for worker spawn events */
  onSpawn: z.string().optional(),
  /** Sound URL for worker stuck events */
  onStuck: z.string().optional(),
  /** Sound URL for worker complete events */
  onComplete: z.string().optional(),
}).optional();

export type SoundsConfig = z.infer<typeof SoundsConfig>;

/**
 * Central orchestration configuration.
 * Stored at ~/.orchestration/config.json
 */
export const CentralConfig = z.object({
  /** Config version for migration support */
  version: z.string().default('1.0'),

  /** Registered repositories keyed by friendly name */
  repos: z.record(z.string(), RepoConfig),

  /** Global hook definitions (can be overridden per-repo) */
  hooks: GlobalHooks.optional(),

  /** Ralph loop settings */
  ralph: RalphConfig.optional(),

  /** Dashboard settings */
  dashboard: DashboardConfig.optional(),

  /** Sound effects (optional) */
  sounds: SoundsConfig,

  /** Default CLI command name */
  cliCommand: z.string().default('orch'),
});

export type CentralConfig = z.infer<typeof CentralConfig>;

/**
 * Execution mode for a session.
 */
export const ExecutionMode = z.enum(['single', 'ralph']);
export type ExecutionMode = z.infer<typeof ExecutionMode>;
