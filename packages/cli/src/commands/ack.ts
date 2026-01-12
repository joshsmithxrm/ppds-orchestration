import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function ackCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();

  // Get session first to show issue number
  const session = await service.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  await service.acknowledgeMessage(sessionId);

  console.log(chalk.green(`✓ Message acknowledged for session #${session.issueNumber}`));
}
