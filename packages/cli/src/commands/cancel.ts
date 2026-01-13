import chalk from 'chalk';
import { createSessionService, formatIssues } from '@ppds-orchestration/core';

export async function cancelCommand(
  sessionId: string,
  options: { keepWorktree?: boolean }
): Promise<void> {
  const service = await createSessionService();

  // Get session first to show issue numbers
  const session = await service.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  // cancel is now an alias for delete
  await service.delete(sessionId, { keepWorktree: options.keepWorktree });

  console.log(chalk.yellow(`\u2713 Session ${formatIssues(session)} deleted`));

  if (options.keepWorktree) {
    console.log(`  Worktree preserved at: ${session.worktreePath}`);
  }
}
