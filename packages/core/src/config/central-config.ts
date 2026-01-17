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
 * Promise configuration for Ralph loop completion.
 * Defines the goal that signals successful task completion.
 */
export const PromiseConfig = z.object({
  /**
   * Type of promise to check:
   * - 'plan_complete': All tasks in plan file are marked done
   * - 'file': Specific file exists at path
   * - 'tests_pass': Test command exits successfully
   * - 'custom': Custom shell command returns success
   */
  type: z.enum(['plan_complete', 'file', 'tests_pass', 'custom']),
  /**
   * Value depends on type:
   * - plan_complete: path to plan file (e.g., 'IMPLEMENTATION_PLAN.md')
   * - file: path to file to check for
   * - tests_pass: test command to run (e.g., 'npm test')
   * - custom: shell command to execute
   */
  value: z.string(),
});

export type PromiseConfig = z.infer<typeof PromiseConfig>;

/**
 * Git operations configuration for Ralph loop.
 * Controls automatic git operations after iterations.
 */
export const GitOperationsConfig = z.object({
  /** Whether to commit changes after each iteration (default: true) */
  commitAfterEach: z.boolean().default(true),
  /** Whether to push changes after each iteration (default: true) */
  pushAfterEach: z.boolean().default(true),
  /** Whether to create a PR when Ralph loop completes (default: true) */
  createPrOnComplete: z.boolean().default(true),
});

export type GitOperationsConfig = z.infer<typeof GitOperationsConfig>;

/**
 * Spawner configuration for worker process management.
 */
export const SpawnerConfig = z.object({
  /** Spawner type: 'windows-terminal' for local dev, 'docker' for containerized */
  type: z.enum(['windows-terminal', 'docker']).default('windows-terminal'),
  /**
   * Use PTY for interactive terminal access via web dashboard.
   * When true, workers spawn with full TTY support for real-time viewing.
   * When false (default), uses headless mode with log file capture.
   */
  usePty: z.boolean().default(false),
  /** Docker-specific settings (only used when type='docker') */
  docker: z.object({
    /** Docker image to use (default: 'ppds-worker:latest') */
    image: z.string().default('ppds-worker:latest'),
    /** Memory limit for container (default: '4g') */
    memoryLimit: z.string().default('4g'),
    /** CPU limit for container (default: '2') */
    cpuLimit: z.string().default('2'),
    /** Additional volume mounts (host:container) */
    volumes: z.array(z.string()).default([]),
    /** Additional environment variables */
    env: z.record(z.string(), z.string()).default({}),
  }).default({}),
});

export type SpawnerConfig = z.infer<typeof SpawnerConfig>;

/**
 * Code review configuration for the review phase.
 */
export const ReviewConfig = z.object({
  /** Maximum number of review cycles before marking as stuck (default: 3) */
  maxCycles: z.number().default(3),
  /** Path to the code review agent prompt file (optional, uses example if not set) */
  agentPromptPath: z.string().optional(),
  /** Timeout for review agent in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs: z.number().default(300_000),
});

export type ReviewConfig = z.infer<typeof ReviewConfig>;

/**
 * Ralph loop execution settings.
 */
export const RalphConfig = z.object({
  /** Maximum number of iterations when not specified at spawn time (default: 10) */
  maxIterations: z.number().default(10),
  /** Promise configuration - defines the goal for task completion */
  promise: PromiseConfig.default({ type: 'plan_complete', value: 'IMPLEMENTATION_PLAN.md' }),
  /** Git operations configuration - controls automatic git actions */
  gitOperations: GitOperationsConfig.default({}),
  /** Optional early-exit signal (file-based by default) */
  doneSignal: DoneSignalConfig.default({ type: 'file', value: '.claude/.ralph-done' }),
  /** Delay between iterations in ms (default: 5000) */
  iterationDelayMs: z.number().default(5000),
  /** Spawner configuration - controls how workers are spawned */
  spawner: SpawnerConfig.default({}),
  /** Code review configuration - controls the review phase */
  reviewConfig: ReviewConfig.default({}),
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
  /** Mute sounds for Ralph loop iterations (default: false) */
  muteRalph: z.boolean().default(false),
  /** Volume level 0-1 (default: 0.25) */
  volume: z.number().min(0).max(1).default(0.25),
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
