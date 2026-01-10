import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function forwardCommand(sessionId: string, message: string): Promise<void> {
  const service = await createSessionService();
  const session = await service.forward(sessionId, message);

  console.log(chalk.green(`✓ Message forwarded to session #${session.issueNumber}`));
  console.log(`  Message: ${message}`);
}
