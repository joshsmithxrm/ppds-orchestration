import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function cancelCommand(
  sessionId: string,
  options: { keepWorktree?: boolean }
): Promise<void> {
  const service = await createSessionService();

  // Get session first to show issue number
  const session = await service.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  await service.cancel(sessionId, { keepWorktree: options.keepWorktree });

  console.log(chalk.yellow(`✓ Session #${session.issueNumber} cancelled`));

  if (options.keepWorktree) {
    console.log(`  Worktree preserved at: ${session.worktreePath}`);
  }
}
