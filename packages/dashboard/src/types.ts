/**
 * Session status enum matching the core library
 */
export type SessionStatus =
  | 'registered'
  | 'planning'
  | 'planning_complete'
  | 'working'
  | 'shipping'
  | 'reviews_in_progress'
  | 'pr_ready'
  | 'stuck'
  | 'paused'
  | 'complete'
  | 'cancelled';

/**
 * Worktree status from git
 */
export interface WorktreeStatus {
  filesChanged: number;
  insertions: number;
  deletions: number;
  lastCommitMessage?: string;
  testsPassing?: boolean | null;
}

/**
 * Session state matching the core library schema
 */
export interface SessionState {
  id: string;
  issueNumber: number;
  issueTitle: string;
  status: SessionStatus;
  branch: string;
  worktreePath: string;
  startedAt: string;
  lastHeartbeat: string;
  stuckReason?: string;
  forwardedMessage?: string;
  pullRequestUrl?: string;
  worktreeStatus?: WorktreeStatus;
}

/**
 * Status display configuration
 */
export interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}

/**
 * Status configuration map
 */
export const STATUS_CONFIG: Record<SessionStatus, StatusConfig> = {
  registered: { label: 'Registered', color: 'text-gray-400', bgColor: 'bg-gray-700', icon: '[ ]' },
  planning: { label: 'Planning', color: 'text-blue-400', bgColor: 'bg-blue-900', icon: '[~]' },
  planning_complete: { label: 'Plan Ready', color: 'text-cyan-400', bgColor: 'bg-cyan-900', icon: '[P]' },
  working: { label: 'Working', color: 'text-green-400', bgColor: 'bg-green-900', icon: '[*]' },
  shipping: { label: 'Shipping', color: 'text-yellow-400', bgColor: 'bg-yellow-900', icon: '[>]' },
  reviews_in_progress: { label: 'In Review', color: 'text-purple-400', bgColor: 'bg-purple-900', icon: '[R]' },
  pr_ready: { label: 'PR Ready', color: 'text-emerald-400', bgColor: 'bg-emerald-900', icon: '[+]' },
  stuck: { label: 'Stuck', color: 'text-red-400', bgColor: 'bg-red-900', icon: '[!]' },
  paused: { label: 'Paused', color: 'text-orange-400', bgColor: 'bg-orange-900', icon: '[||]' },
  complete: { label: 'Complete', color: 'text-gray-500', bgColor: 'bg-gray-800', icon: '[v]' },
  cancelled: { label: 'Cancelled', color: 'text-gray-600', bgColor: 'bg-gray-900', icon: '[x]' },
};
