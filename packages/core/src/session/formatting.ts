import { SessionState, SessionStatus } from './types.js';

/**
 * Status icons used in CLI and web displays.
 * Browser-safe - no Node.js dependencies.
 */
export const STATUS_ICONS: Record<SessionStatus, string> = {
  registered: '[ ]',
  planning: '[~]',
  planning_complete: '[P]',
  working: '[*]',
  shipping: '[>]',
  reviews_in_progress: '[R]',
  pr_ready: '[+]',
  stuck: '[!]',
  paused: '[||]',
  complete: '[\u2713]',
  cancelled: '[x]',
  deleting: '[...]',
  deletion_failed: '[!!]',
};

/**
 * Tailwind CSS classes for web dashboard.
 * Browser-safe - no Node.js dependencies.
 */
export const STATUS_CSS_CLASSES: Record<SessionStatus, string> = {
  registered: 'bg-gray-500',
  planning: 'bg-blue-500',
  planning_complete: 'bg-purple-500',
  working: 'bg-green-500',
  shipping: 'bg-cyan-500',
  reviews_in_progress: 'bg-cyan-500',
  pr_ready: 'bg-emerald-400',
  stuck: 'bg-red-500',
  paused: 'bg-yellow-500',
  complete: 'bg-gray-600',
  cancelled: 'bg-gray-600',
  deleting: 'bg-orange-500',
  deletion_failed: 'bg-red-700',
};

/**
 * Statuses that should show a stale indicator when heartbeat is old.
 */
export const ACTIVE_STATUSES_FOR_STALE: SessionStatus[] = [
  'planning',
  'planning_complete',
  'working',
];

/**
 * Formats the issue numbers from a session for display.
 * Single issue: "#5"
 * Multiple issues: "#5, #6, #7"
 */
export function formatIssues(session: SessionState): string {
  if (session.issues.length === 1) {
    return `#${session.issues[0].number}`;
  }
  return session.issues.map(i => `#${i.number}`).join(', ');
}

/**
 * Formats the session title for display.
 * Single issue: returns the issue title
 * Multiple issues: returns "N issues"
 */
export function formatSessionTitle(session: SessionState): string {
  if (session.issues.length === 1) {
    return session.issues[0].title;
  }
  return `${session.issues.length} issues`;
}

/**
 * Checks if a status is terminal (session is done).
 */
export function isTerminalStatus(status: SessionStatus): boolean {
  return status === 'complete' || status === 'cancelled';
}

/**
 * Formats a status string for display (uppercase, spaces).
 */
export function formatStatusText(status: SessionStatus): string {
  return status.toUpperCase().replace('_', ' ');
}
