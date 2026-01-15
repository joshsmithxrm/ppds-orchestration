import { spawn } from 'node:child_process';

/**
 * Options for GitHub notifications.
 */
export interface NotificationOptions {
  /** GitHub owner */
  githubOwner: string;
  /** GitHub repo name */
  githubRepo: string;
  /** Issue number to comment on */
  issueNumber: number;
  /** Working directory for gh CLI */
  cwd: string;
}

/**
 * Result of posting a notification.
 */
export interface NotificationResult {
  success: boolean;
  /** URL of the created comment */
  commentUrl?: string;
  error?: string;
}

/**
 * Posts a comment on a GitHub issue.
 */
async function postComment(
  options: NotificationOptions,
  body: string
): Promise<NotificationResult> {
  const { githubOwner, githubRepo, issueNumber, cwd } = options;

  return new Promise((resolve) => {
    const proc = spawn('gh', [
      'issue', 'comment', issueNumber.toString(),
      '--repo', `${githubOwner}/${githubRepo}`,
      '--body', body,
    ], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: `Failed to post comment: ${stderr || 'Unknown error'}`,
        });
        return;
      }

      resolve({
        success: true,
        commentUrl: stdout.trim() || undefined,
      });
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to run gh CLI: ${error.message}`,
      });
    });
  });
}

/**
 * Notifies that a PR is ready for review.
 */
export async function notifyPRReady(
  options: NotificationOptions & {
    prUrl: string;
    prNumber: number;
    summary?: string;
  }
): Promise<NotificationResult> {
  const body = formatPRReadyNotification(options);
  return postComment(options, body);
}

/**
 * Notifies that implementation is stuck.
 */
export async function notifyImplementationStuck(
  options: NotificationOptions & {
    reason: string;
    iteration?: number;
    worktreePath: string;
  }
): Promise<NotificationResult> {
  const body = formatStuckNotification(options);
  return postComment(options, body);
}

/**
 * Notifies that review cycle is stuck.
 */
export async function notifyReviewStuck(
  options: NotificationOptions & {
    reviewCycle: number;
    lastFeedback?: string;
  }
): Promise<NotificationResult> {
  const body = formatReviewStuckNotification(options);
  return postComment(options, body);
}

// ============================================
// Notification Templates
// ============================================

function formatPRReadyNotification(options: {
  prUrl: string;
  prNumber: number;
  summary?: string;
}): string {
  const { prUrl, prNumber, summary } = options;

  let body = `## PR Ready for Review\n\n`;
  body += `Pull request #${prNumber} is ready for human review.\n\n`;
  body += `**PR Link:** ${prUrl}\n\n`;

  if (summary) {
    body += `**Summary:** ${summary}\n\n`;
  }

  body += `---\n`;
  body += `*Automated notification from PPDS Orchestration*`;

  return body;
}

function formatStuckNotification(options: {
  reason: string;
  iteration?: number;
  worktreePath: string;
}): string {
  const { reason, iteration, worktreePath } = options;

  let body = `## Implementation Stuck\n\n`;
  body += `The automated worker has encountered an issue and needs human assistance.\n\n`;

  if (iteration !== undefined) {
    body += `**Iteration:** ${iteration}\n`;
  }

  body += `**Reason:** ${reason}\n\n`;
  body += `**Worktree:** \`${worktreePath}\`\n\n`;

  body += `### Next Steps\n\n`;
  body += `1. Review the worker's progress in the worktree\n`;
  body += `2. Check \`.claude/.stuck\` file for details if present\n`;
  body += `3. Provide guidance or take manual action\n`;
  body += `4. Restart the worker when ready\n\n`;

  body += `---\n`;
  body += `*Automated notification from PPDS Orchestration*`;

  return body;
}

function formatReviewStuckNotification(options: {
  reviewCycle: number;
  lastFeedback?: string;
}): string {
  const { reviewCycle, lastFeedback } = options;

  let body = `## Review Cycle Stuck\n\n`;
  body += `The automated worker has failed code review ${reviewCycle} times and needs human intervention.\n\n`;

  body += `**Review Cycles:** ${reviewCycle}\n\n`;

  if (lastFeedback) {
    body += `### Last Review Feedback\n\n`;
    body += `${lastFeedback}\n\n`;
  }

  body += `### Next Steps\n\n`;
  body += `1. Review the code changes manually\n`;
  body += `2. Either fix the issues yourself or provide clearer guidance\n`;
  body += `3. Consider simplifying the requirements if the task is too complex\n\n`;

  body += `---\n`;
  body += `*Automated notification from PPDS Orchestration*`;

  return body;
}
