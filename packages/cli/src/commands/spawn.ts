import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function spawnCommand(issueNumbers: number[]): Promise<void> {
  if (issueNumbers.length === 0) {
    throw new Error('At least one issue number is required');
  }

  const service = await createSessionService();

  // Spawn each issue as a separate session
  for (const issueNumber of issueNumbers) {
    console.log(chalk.blue(`Spawning worker for issue #${issueNumber}...`));

    const session = await service.spawn(issueNumber);

    console.log(chalk.green(`\u2713 Worker spawned`));
    console.log(`  Issue: ${chalk.cyan(`#${session.issue.number}`)}`);
    console.log(`  Branch: ${chalk.cyan(session.branch)}`);
    console.log(`  Worktree: ${chalk.cyan(session.worktreePath)}`);
    console.log(`  Status: ${chalk.yellow(session.status)}`);
    console.log();
  }

  if (issueNumbers.length > 1) {
    console.log(chalk.green(`\u2713 ${issueNumbers.length} workers spawned as separate sessions`));
  }
}
