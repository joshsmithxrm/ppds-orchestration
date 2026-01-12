import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function ackCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();
  const session = await service.acknowledgeMessage(sessionId);
  console.log(chalk.green(`✓ Message acknowledged for session #${session.issueNumber}`));
}
