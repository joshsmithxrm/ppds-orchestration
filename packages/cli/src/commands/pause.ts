import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function pauseCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();

  // Get session first to check if it's already paused
  const before = await service.get(sessionId);
  if (!before) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  if (before.status === 'paused') {
    console.log(chalk.dim(`Session #${before.issueNumber} is already paused`));
    return;
  }

  const session = await service.pause(sessionId);
  console.log(chalk.yellow(`⏸ Paused session #${session.issueNumber}`));
}
