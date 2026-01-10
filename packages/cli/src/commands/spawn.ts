import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function spawnCommand(issueNumber: number): Promise<void> {
  console.log(chalk.blue(`Spawning worker for issue #${issueNumber}...`));

  const service = await createSessionService();
  const session = await service.spawn(issueNumber);

  console.log(chalk.green(`✓ Worker spawned for issue #${issueNumber}`));
  console.log(`  Branch: ${chalk.cyan(session.branch)}`);
  console.log(`  Worktree: ${chalk.cyan(session.worktreePath)}`);
  console.log(`  Status: ${chalk.yellow(session.status)}`);
}
