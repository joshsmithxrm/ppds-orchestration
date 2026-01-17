import chalk from 'chalk';
import { createSessionService, SessionPhase } from '@ppds-orchestration/core';

export interface SpawnCommandOptions {
  /** Session phase: 'planning' (creates plan) or 'building' (implements tasks). Default: 'planning'. */
  phase?: SessionPhase;
}

export async function spawnCommand(
  issueNumbers: number[],
  options?: SpawnCommandOptions
): Promise<void> {
  if (issueNumbers.length === 0) {
    throw new Error('At least one issue number is required');
  }

  const service = await createSessionService();
  const phase = options?.phase ?? 'planning';

  // Spawn each issue as a separate session
  for (const issueNumber of issueNumbers) {
    console.log(chalk.blue(`Spawning ${phase} worker for issue #${issueNumber}...`));

    const session = await service.spawn(issueNumber, { phase });

    console.log(chalk.green(`\u2713 Worker spawned`));
    console.log(`  Issue: ${chalk.cyan(`#${session.issue.number}`)}`);
    console.log(`  Branch: ${chalk.cyan(session.branch)}`);
    console.log(`  Worktree: ${chalk.cyan(session.worktreePath)}`);
    console.log(`  Status: ${chalk.yellow(session.status)}`);
    console.log(`  Phase: ${chalk.magenta(phase)}`);
    console.log();
  }

  if (issueNumbers.length > 1) {
    console.log(chalk.green(`\u2713 ${issueNumbers.length} ${phase} workers spawned as separate sessions`));
  }
}
