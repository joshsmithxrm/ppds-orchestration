import chalk from 'chalk';
import { createSessionService, formatIssues } from '@ppds-orchestration/core';

export async function forwardCommand(sessionId: string, message: string): Promise<void> {
  const service = await createSessionService();
  const session = await service.forward(sessionId, message);

  console.log(chalk.green(`\u2713 Message forwarded to session ${formatIssues(session)}`));
  console.log(`  Message: ${message}`);
}
