import chalk from 'chalk';
import { createSessionService, formatIssues } from '@ppds-orchestration/core';

export async function ackCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();
  const session = await service.acknowledgeMessage(sessionId);
  console.log(chalk.green(`\u2713 Message acknowledged for session ${formatIssues(session)}`));
}
