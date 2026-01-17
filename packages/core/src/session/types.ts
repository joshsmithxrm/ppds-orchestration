import { z } from 'zod';

/**
 * Execution mode for a session.
 * - 'single': Worker runs autonomously until PR (current behavior)
 * - 'ralph': Worker completes one task, exits, and is re-spawned for next task
 */
export const ExecutionMode = z.enum(['single', 'ralph']);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

/**
 * Session lifecycle status.
 * Matches the C# SessionStatus enum from PPDS.
 */
export const SessionStatus = z.enum([
  'registered',        // Worktree created, worker starting up
  'planning',          // Worker is exploring codebase and creating plan
  'planning_complete', // Worker has written plan, continuing to implementation
  'working',           // Worker actively implementing
  'shipping',          // PR created, waiting for required CI checks
  'reviews_in_progress', // CI passed, addressing bot review comments
  'pr_ready',          // All bot comments addressed, PR ready for human review
  'stuck',             // Worker hit a domain gate or repeated failure
  'paused',            // Human requested pause
  'complete',          // PR created and CI passed
  'cancelled',         // Human cancelled the session
  'deleting',          // Cleanup in progress
  'deletion_failed',   // Worktree cleanup failed
]);

export type SessionStatus = z.infer<typeof SessionStatus>;

/**
 * Reference to a GitHub issue.
 */
export const IssueRef = z.object({
  /** GitHub issue number. */
  number: z.number(),

  /** Issue title from GitHub. */
  title: z.string(),

  /** Issue body/description (optional, used for prompt generation). */
  body: z.string().optional(),
});

export type IssueRef = z.infer<typeof IssueRef>;

/**
 * Git worktree status information.
 */
export const WorktreeStatus = z.object({
  filesChanged: z.number(),
  insertions: z.number(),
  deletions: z.number(),
  lastCommitMessage: z.string().nullable(),
  lastTestRun: z.string().datetime().nullable(),
  testsPassing: z.boolean().nullable(),
  changedFiles: z.array(z.string()),
});

export type WorktreeStatus = z.infer<typeof WorktreeStatus>;

/**
 * Represents the state of a worker session.
 * This is the orchestrator's view of the session, stored in ~/.orchestration/{project}/sessions/.
 */
export const SessionState = z.object({
  /** Unique session identifier (issue number as string, or UUID for workflows). */
  id: z.string(),

  /** The GitHub issue this session is working on. */
  issue: IssueRef,

  /** Current session status. */
  status: SessionStatus,

  /** Execution mode: 'single' (autonomous) or 'ralph' (iterative loop). */
  mode: ExecutionMode.default('single'),

  /** Git branch name for this session. */
  branch: z.string(),

  /** Absolute path to the worktree directory. */
  worktreePath: z.string(),

  /** When the session was started (ISO timestamp). */
  startedAt: z.string().datetime(),

  /** When the session last reported status (ISO timestamp). */
  lastHeartbeat: z.string().datetime(),

  /** Reason for stuck status (undefined unless status is 'stuck'). */
  stuckReason: z.string().optional(),

  /** Message forwarded from orchestrator (undefined if none pending). */
  forwardedMessage: z.string().optional(),

  /** Pull request URL (undefined until PR is created). */
  pullRequestUrl: z.string().url().optional(),

  /** Git status summary for the worktree. */
  worktreeStatus: WorktreeStatus.optional(),

  /** Workflow ID if this session is part of a workflow (future use). */
  workflowId: z.string().optional(),

  /** Stage ID within the workflow (future use). */
  stageId: z.string().optional(),

  /** Error message if deletion failed (only set when status is 'deletion_failed'). */
  deletionError: z.string().optional(),

  /** Previous status before deletion attempt (for rollback). */
  previousStatus: SessionStatus.optional(),

  /** Current review cycle count (incremented after each NEEDS_WORK verdict). */
  reviewCycle: z.number().optional(),

  /** Feedback from the last review (used to guide next iteration). */
  lastReviewFeedback: z.string().optional(),

  /** Spawn ID from the worker spawner (used for status checks and stopping). */
  spawnId: z.string().optional(),
});

export type SessionState = z.infer<typeof SessionState>;

/**
 * Static context written to the worktree at spawn time.
 * Skills and workers read this for identity.
 */
export const SessionContext = z.object({
  /** Unique session identifier. */
  sessionId: z.string(),

  /** The GitHub issue this session is working on. */
  issue: IssueRef,

  /** GitHub repository info. */
  github: z.object({
    owner: z.string(),
    repo: z.string(),
  }),

  /** Git branch name. */
  branch: z.string(),

  /** Absolute path to the worktree. */
  worktreePath: z.string(),

  /** Pre-formatted commands for worker use. */
  commands: z.object({
    update: z.string(),
    heartbeat: z.string(),
  }),

  /** When the session was spawned (ISO timestamp). */
  spawnedAt: z.string().datetime(),

  /** Path to the main session file (workers update this for status). */
  sessionFilePath: z.string(),
});

export type SessionContext = z.infer<typeof SessionContext>;

/**
 * Dynamic state written to the worktree for message forwarding.
 * Orchestrator writes this; workers read it.
 */
export const SessionDynamicState = z.object({
  /** Current status. */
  status: SessionStatus,

  /** Message forwarded from orchestrator. */
  forwardedMessage: z.string().nullable().optional(),

  /** When this was last updated (ISO timestamp). */
  lastUpdated: z.string().datetime(),
});

export type SessionDynamicState = z.infer<typeof SessionDynamicState>;

/**
 * Request to spawn a new worker.
 */
export interface WorkerSpawnRequest {
  sessionId: string;
  issue: IssueRef;
  workingDirectory: string;
  promptFilePath: string;
  /** Full prompt content to pass to Claude (avoids file read indirection). */
  promptContent: string;
  githubOwner: string;
  githubRepo: string;
  /** Ralph iteration number (1-indexed, for log file naming). */
  iteration?: number;
  /**
   * Use PTY for interactive terminal access.
   * When true, spawns with full PTY support for web terminal viewing.
   * When false (default), uses headless mode with log capture.
   */
  usePty?: boolean;
}

/**
 * Result of listing sessions with cleanup information.
 */
export interface SessionListResult {
  sessions: SessionState[];
  cleanedIssueNumbers: number[];
}

/**
 * Inferred worker activity status based on file system activity.
 */
export type InferredActivity = 'active' | 'stale' | 'unknown';

/**
 * Stale threshold - sessions without heartbeat for this long are considered stale.
 */
export const STALE_THRESHOLD_MS = 90_000; // 90 seconds

/**
 * Represents an orphaned worktree (worktree exists without session file).
 */
export const OrphanedWorktree = z.object({
  /** Repo ID this orphan belongs to. */
  repoId: z.string(),

  /** Absolute path to the orphaned worktree. */
  worktreePath: z.string(),

  /** Branch name extracted from git. */
  branchName: z.string().optional(),

  /** Issue number if session-context.json is recoverable. */
  issueNumber: z.number().optional(),

  /** Session ID if recoverable from context. */
  sessionId: z.string().optional(),

  /** When the orphan was detected (ISO timestamp). */
  detectedAt: z.string().datetime(),

  /** Error message if context reading failed. */
  contextError: z.string().optional(),
});

export type OrphanedWorktree = z.infer<typeof OrphanedWorktree>;

/**
 * Result of a deletion operation.
 */
export interface DeleteResult {
  success: boolean;
  sessionDeleted: boolean;
  worktreeRemoved: boolean;
  error?: string;
  /** If worktree removal failed, the path that may be orphaned. */
  orphanedWorktreePath?: string;
}

/**
 * Result of a worktree removal attempt.
 */
export interface WorktreeRemovalResult {
  success: boolean;
  error?: string;
  /** True if the worktree didn't exist (not an error). */
  notFound?: boolean;
}
