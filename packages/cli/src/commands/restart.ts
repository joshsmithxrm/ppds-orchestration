import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function restartCommand(sessionId: string): Promise<void> {
  console.log(chalk.blue(`Restarting stuck session ${sessionId}...`));

  const service = await createSessionService();
  const session = await service.restart(sessionId);

  console.log(chalk.green(`\u2713 Session restarted`));
  console.log(`  Issue: ${chalk.cyan(`#${session.issue.number}`)}`);
  console.log(`  Status: ${chalk.yellow(session.status)}`);
}
