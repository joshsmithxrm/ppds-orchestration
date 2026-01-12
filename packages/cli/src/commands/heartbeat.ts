import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function heartbeatCommand(
  sessionId: string,
  options: { quiet?: boolean }
): Promise<void> {
  const service = await createSessionService();
  const result = await service.heartbeat(sessionId);

  if (!options.quiet) {
    console.log(chalk.green('✓ Heartbeat recorded'));
    if (result.hasMessage) {
      console.log(chalk.yellow('  You have a forwarded message - check session-state.json'));
    }
  }
}
