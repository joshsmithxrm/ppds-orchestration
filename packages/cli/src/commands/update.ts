import chalk from 'chalk';
import { createSessionService, SessionStatus, SessionState } from '@ppds-orchestration/core';

const VALID_STATUSES = [
  'registered',
  'planning',
  'planning_complete',
  'working',
  'shipping',
  'reviews_in_progress',
  'pr_ready',
  'stuck',
  'paused',
  'complete',
  'cancelled',
];

function formatIssues(session: SessionState): string {
  return session.issues.map(i => `#${i.number}`).join(', ');
}

export async function updateCommand(options: {
  id: string;
  status: string;
  reason?: string;
  pr?: string;
}): Promise<void> {
  // Validate status
  if (!VALID_STATUSES.includes(options.status)) {
    throw new Error(
      `Invalid status '${options.status}'. Valid statuses: ${VALID_STATUSES.join(', ')}`
    );
  }

  // Require reason for stuck status
  if (options.status === 'stuck' && !options.reason) {
    throw new Error("Status 'stuck' requires --reason");
  }

  const service = await createSessionService();
  const session = await service.update(
    options.id,
    options.status as SessionStatus,
    {
      reason: options.reason,
      prUrl: options.pr,
    }
  );

  console.log(chalk.green(`\u2713 Session ${formatIssues(session)} updated to ${options.status}`));

  if (options.reason) {
    console.log(`  Reason: ${options.reason}`);
  }

  if (options.pr) {
    console.log(`  PR: ${options.pr}`);
  }
}
