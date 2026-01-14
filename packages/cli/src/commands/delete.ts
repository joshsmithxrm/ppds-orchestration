import chalk from 'chalk';
import { createSessionService, formatIssues } from '@ppds-orchestration/core';

export async function deleteCommand(
  sessionId: string,
  options: { keepWorktree?: boolean }
): Promise<void> {
  const service = await createSessionService();
  const session = await service.get(sessionId);

  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  console.log(chalk.blue(`Deleting session ${sessionId} (${formatIssues(session)})...`));

  await service.delete(sessionId, { keepWorktree: options.keepWorktree });

  console.log(chalk.green(`\u2713 Session deleted`));

  if (options.keepWorktree) {
    console.log(`  Worktree preserved at: ${chalk.cyan(session.worktreePath)}`);
  }
}
