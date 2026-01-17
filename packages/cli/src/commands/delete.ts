import chalk from 'chalk';
import { createSessionService, formatIssues, DeletionMode } from '@ppds-orchestration/core';

export async function deleteCommand(
  sessionId: string,
  options: { mode?: DeletionMode }
): Promise<void> {
  const service = await createSessionService();
  const session = await service.get(sessionId);

  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  const deletionMode = options.mode ?? 'folder-only';
  console.log(chalk.blue(`Deleting session ${sessionId} (${formatIssues(session)})...`));
  console.log(`  Deletion mode: ${chalk.cyan(deletionMode)}`);

  await service.delete(sessionId, { deletionMode });

  console.log(chalk.green(`\u2713 Session deleted`));
}
