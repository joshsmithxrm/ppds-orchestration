/**
 * Tauri API wrapper with browser fallback
 *
 * When running inside Tauri (via `npm run tauri:dev`), this uses the real Tauri API.
 * When running in a regular browser (via `npm run dev`), this provides mock data
 * for UI development and debugging.
 */

import type { SessionState } from '../types';

// Check if we're running inside Tauri
declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri = (): boolean => {
  return typeof window !== 'undefined' &&
    (window.__TAURI__ !== undefined || window.__TAURI_INTERNALS__ !== undefined);
};

// Mock session data for browser development
const mockSessions: SessionState[] = [
  {
    id: 'mock-1',
    issueNumber: 42,
    issueTitle: 'Add user authentication flow',
    status: 'working',
    branch: 'feat/42-user-auth',
    worktreePath: 'C:/VS/ppds-orchestration/.worktrees/42-user-auth',
    startedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 min ago
    lastHeartbeat: new Date(Date.now() - 30 * 1000).toISOString(), // 30 sec ago
    worktreeStatus: {
      filesChanged: 5,
      insertions: 142,
      deletions: 23,
      lastCommitMessage: 'feat: add login form component',
    },
  },
  {
    id: 'mock-2',
    issueNumber: 38,
    issueTitle: 'Fix memory leak in worker pool',
    status: 'working',
    branch: 'fix/38-memory-leak',
    worktreePath: 'C:/VS/ppds-orchestration/.worktrees/38-memory-leak',
    startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 min ago
    lastHeartbeat: new Date(Date.now() - 15 * 1000).toISOString(),
    worktreeStatus: {
      filesChanged: 2,
      insertions: 31,
      deletions: 8,
      lastCommitMessage: 'fix: dispose worker on cleanup',
    },
  },
  {
    id: 'mock-3',
    issueNumber: 45,
    issueTitle: 'Implement dark mode toggle',
    status: 'stuck',
    branch: 'feat/45-dark-mode',
    worktreePath: 'C:/VS/ppds-orchestration/.worktrees/45-dark-mode',
    startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    lastHeartbeat: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
    stuckReason: 'Cannot find the theme provider context. Need guidance on where to add ThemeProvider wrapper.',
    worktreeStatus: {
      filesChanged: 3,
      insertions: 67,
      deletions: 12,
      lastCommitMessage: 'wip: add theme context',
    },
  },
  {
    id: 'mock-4',
    issueNumber: 31,
    issueTitle: 'Add unit tests for session service',
    status: 'complete',
    branch: 'test/31-session-tests',
    worktreePath: 'C:/VS/ppds-orchestration/.worktrees/31-session-tests',
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    lastHeartbeat: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // 90 min ago
    pullRequestUrl: 'https://github.com/example/repo/pull/87',
    worktreeStatus: {
      filesChanged: 8,
      insertions: 423,
      deletions: 15,
      lastCommitMessage: 'test: complete session service coverage',
      testsPassing: true,
    },
  },
  {
    id: 'mock-5',
    issueNumber: 50,
    issueTitle: 'Refactor CLI command structure',
    status: 'shipping',
    branch: 'refactor/50-cli-commands',
    worktreePath: 'C:/VS/ppds-orchestration/.worktrees/50-cli-commands',
    startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    lastHeartbeat: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    worktreeStatus: {
      filesChanged: 12,
      insertions: 245,
      deletions: 189,
      lastCommitMessage: 'refactor: modularize command handlers',
      testsPassing: true,
    },
  },
];

// Store for mock state (allows simulating updates)
let currentMockSessions = [...mockSessions];

/**
 * Mock invoke function for browser development
 */
async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  switch (cmd) {
    case 'get_sessions':
      return currentMockSessions as T;

    case 'forward_message':
      console.log('[Mock] Forwarding message:', args);
      // Simulate updating the stuck session
      if (args?.sessionId === 'mock-3') {
        currentMockSessions = currentMockSessions.map((s) =>
          s.id === 'mock-3'
            ? { ...s, status: 'working' as const, forwardedMessage: args.message as string, stuckReason: undefined }
            : s
        );
      }
      return undefined as T;

    case 'cancel_session':
      console.log('[Mock] Cancelling session:', args);
      currentMockSessions = currentMockSessions.map((s) =>
        s.id === args?.sessionId ? { ...s, status: 'cancelled' as const } : s
      );
      return undefined as T;

    case 'spawn_worker': {
      const issueNumber = args?.issueNumber as number;
      if (!issueNumber || issueNumber <= 0) {
        throw new Error('Invalid issue number');
      }

      const newSessionId = `session-${issueNumber}-${Date.now()}`;
      const now = new Date().toISOString();

      const newSession: SessionState = {
        id: newSessionId,
        issueNumber,
        issueTitle: `Mock Issue #${issueNumber}`,
        status: 'registered',
        branch: `feat/${issueNumber}-mock-feature`,
        worktreePath: `/mock/worktrees/${issueNumber}`,
        startedAt: now,
        lastHeartbeat: now,
      };

      currentMockSessions = [...currentMockSessions, newSession];
      console.log('[Mock] Spawned worker:', newSessionId);
      return newSessionId as T;
    }

    default:
      console.warn(`[Mock] Unknown command: ${cmd}`);
      return undefined as T;
  }
}

/**
 * Mock listen function for browser development
 */
async function mockListen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  console.log(`[Mock] Listening for event: ${event}`);

  // Simulate periodic updates for demo purposes
  const interval = setInterval(() => {
    // Randomly update a session's heartbeat
    const idx = Math.floor(Math.random() * currentMockSessions.length);
    if (currentMockSessions[idx].status === 'working') {
      currentMockSessions[idx] = {
        ...currentMockSessions[idx],
        lastHeartbeat: new Date().toISOString(),
      };

      handler({
        payload: {
          eventType: 'update',
          session: currentMockSessions[idx],
        } as T,
      });
    }
  }, 10000); // Every 10 seconds

  // Return unlisten function
  return () => {
    clearInterval(interval);
    console.log(`[Mock] Stopped listening for event: ${event}`);
  };
}

/**
 * Invoke wrapper - uses real Tauri API or mock
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(cmd, args);
  }
  return mockInvoke<T>(cmd, args);
}

/**
 * Listen wrapper - uses real Tauri API or mock
 */
export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  if (isTauri()) {
    const { listen: tauriListen } = await import('@tauri-apps/api/event');
    return tauriListen<T>(event, handler);
  }
  return mockListen<T>(event, handler);
}
