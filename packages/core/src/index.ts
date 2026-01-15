// Session types and interfaces
export {
  SessionStatus,
  SessionState,
  SessionContext,
  SessionDynamicState,
  WorktreeStatus,
  ExecutionMode,
  IssueRef,
  getPrimaryIssue,
  getIssueNumbers,
  STALE_THRESHOLD_MS,
} from './session/types.js';

// Session formatting utilities (browser-safe)
export {
  STATUS_ICONS,
  STATUS_CSS_CLASSES,
  ACTIVE_STATUSES_FOR_STALE,
  formatIssues,
  formatSessionTitle,
  isTerminalStatus,
  formatStatusText,
} from './session/formatting.js';

// Note: CLI-specific formatting utilities (STATUS_COLORS, getColoredStatusIcon, getColoredStatusText)
// are available from '@ppds-orchestration/core/session/formatting-cli' for Node.js environments only.

// Worker prompt builder
export { WorkerPromptBuilder } from './session/worker-prompt-builder.js';
export type { PromptContext } from './session/worker-prompt-builder.js';

export type {
  WorkerSpawnRequest,
  SessionListResult,
  InferredActivity,
  DeleteResult,
  WorktreeRemovalResult,
} from './session/types.js';

// Orphan detection
export { OrphanedWorktree } from './session/types.js';
export type { OrphanedWorktree as OrphanedWorktreeType } from './session/types.js';

// Central config types
export {
  CentralConfig,
  RepoConfig,
  HookConfig,
  HookConfigInput,
  GlobalHooks,
  RalphConfig,
  DashboardConfig,
  DoneSignalConfig,
  PromiseConfig,
  GitOperationsConfig,
  SpawnerConfig,
  ReviewConfig,
} from './config/central-config.js';

// Config loader utilities
export {
  loadCentralConfig,
  saveCentralConfig,
  centralConfigExists,
  getRepoEffectiveConfig,
  getPromptHooks,
  createDefaultConfig,
  expandPath,
  DEFAULT_CONFIG_PATH,
} from './config/config-loader.js';

// Session store
export { SessionStore } from './session/session-store.js';

// Session service
export { SessionService, createSessionService } from './session/session-service.js';
export type { SessionServiceConfig, SpawnOptions } from './session/session-service.js';

// Git utilities
export { GitUtils } from './git/git-utils.js';

// Worker spawner
export type { WorkerSpawner, SpawnResult, SpawnInfo, WorkerStatus } from './spawner/worker-spawner.js';
export { WindowsTerminalSpawner, createSpawner } from './spawner/windows-terminal-spawner.js';

// Session watcher
export { SessionWatcher } from './watcher/session-watcher.js';
export type { SessionWatcherEvent, SessionWatcherCallback } from './watcher/session-watcher.js';

// Hook executor
export { HookExecutor } from './hooks/hook-executor.js';
export type { HookContext, HookResult } from './hooks/hook-executor.js';

// Process tracker
export { ProcessTracker } from './process/process-tracker.js';
export type { TrackedProcess, ProcessExitCallback } from './process/process-tracker.js';

// Plan parser utilities
export {
  parsePlanFile,
  getCurrentTask,
  isPromiseMet,
} from './utils/plan-parser.js';
export type { Task, PlanSummary, ParsedPlan } from './utils/plan-parser.js';
