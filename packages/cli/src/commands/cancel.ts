import chalk from 'chalk';
import { createSessionService, SessionState } from '@ppds-orchestration/core';

function formatIssues(session: SessionState): string {
  return session.issues.map(i => `#${i.number}`).join(', ');
}

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

  await service.cancel(sessionId, { keepWorktree: options.keepWorktree });

  console.log(chalk.yellow(`\u2713 Session ${formatIssues(session)} cancelled`));

  if (options.keepWorktree) {
    console.log(`  Worktree preserved at: ${session.worktreePath}`);
  }
}
