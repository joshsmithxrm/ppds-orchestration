import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function resumeCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();

  // Get session first to check if it's paused
  const before = await service.get(sessionId);
  if (!before) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  if (before.status !== 'paused') {
    console.log(chalk.dim(`Session #${before.issueNumber} is not paused (status: ${before.status})`));
    return;
  }

  const session = await service.resume(sessionId);

  console.log(chalk.green(`▶ Resumed session #${session.issueNumber}`));
}
