import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function spawnCommand(issueNumbers: number[]): Promise<void> {
  if (issueNumbers.length === 0) {
    throw new Error('At least one issue number is required');
  }

  const label = issueNumbers.length === 1
    ? `issue #${issueNumbers[0]}`
    : `issues #${issueNumbers.join(', #')}`;

  console.log(chalk.blue(`Spawning worker for ${label}...`));

  const service = await createSessionService();
  const session = await service.spawn(issueNumbers);

  console.log(chalk.green(`\u2713 Worker spawned`));
  console.log(`  Issues: ${session.issues.map(i => chalk.cyan(`#${i.number}`)).join(', ')}`);
  console.log(`  Branch: ${chalk.cyan(session.branch)}`);
  console.log(`  Worktree: ${chalk.cyan(session.worktreePath)}`);
  console.log(`  Status: ${chalk.yellow(session.status)}`);
}
