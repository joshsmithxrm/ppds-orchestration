// Session types and interfaces
export {
  SessionStatus,
  SessionState,
  SessionContext,
  SessionDynamicState,
  WorktreeStatus,
  STALE_THRESHOLD_MS,
} from './session/types.js';

export type {
  WorkerSpawnRequest,
  SessionListResult,
  InferredActivity,
} from './session/types.js';

// Session store
export { SessionStore } from './session/session-store.js';

// Session service
export { SessionService, createSessionService } from './session/session-service.js';
export type { SessionServiceConfig } from './session/session-service.js';

// Git utilities
export { GitUtils } from './git/git-utils.js';

// Worker spawner
export type { WorkerSpawner } from './spawner/worker-spawner.js';
export { WindowsTerminalSpawner, createSpawner } from './spawner/windows-terminal-spawner.js';

// Session watcher
export { SessionWatcher } from './watcher/session-watcher.js';
export type { SessionWatcherEvent, SessionWatcherCallback } from './watcher/session-watcher.js';
