import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function pauseCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();

  const session = await service.pause(sessionId);

  if (session.status === 'paused') {
    console.log(chalk.yellow(`⏸ Paused session #${session.issueNumber}`));
  } else {
    console.log(chalk.dim(`Session #${session.issueNumber} was already paused`));
  }
}
