import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function deleteCommand(
  sessionId: string,
  options: { keepWorktree?: boolean }
): Promise<void> {
  const service = await createSessionService();
  const session = await service.get(sessionId);

  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  const issues = session.issues.map(i => `#${i.number}`).join(', ');
  console.log(chalk.blue(`Deleting session ${sessionId} (${issues})...`));

  await service.delete(sessionId, { keepWorktree: options.keepWorktree });

  console.log(chalk.green(`\u2713 Session deleted`));

  if (options.keepWorktree) {
    console.log(`  Worktree preserved at: ${chalk.cyan(session.worktreePath)}`);
  }
}
