/**
 * Shared status color and icon definitions for the web dashboard.
 * These are intentionally duplicated from core to avoid importing Node.js dependencies.
 */

export const statusColors: Record<string, string> = {
  registered: 'bg-gray-500',
  planning: 'bg-blue-500',
  planning_complete: 'bg-ppds-ralph',
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

export const statusIcons: Record<string, string> = {
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

export const statusTextColors: Record<string, string> = {
  running: 'text-green-400',
  waiting: 'text-yellow-400',
  done: 'text-blue-400',
  stuck: 'text-red-400',
  paused: 'text-ppds-muted',
};

export const statusLabels: Record<string, string> = {
  running: 'Running',
  waiting: 'Waiting',
  done: 'Complete',
  stuck: 'Stuck',
  paused: 'Paused',
};
