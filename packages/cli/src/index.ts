#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { spawnCommand } from './commands/spawn.js';
import { listCommand } from './commands/list.js';
import { getCommand } from './commands/get.js';
import { updateCommand } from './commands/update.js';
import { forwardCommand } from './commands/forward.js';
import { cancelCommand } from './commands/cancel.js';
import { heartbeatCommand } from './commands/heartbeat.js';
import { ackCommand } from './commands/ack.js';
import { pauseCommand } from './commands/pause.js';
import { resumeCommand } from './commands/resume.js';
import { dashboardCommand } from './commands/dashboard.js';

const program = new Command();

/**
 * Wraps a command action with standard error handling.
 */
function withErrorHandling<T extends unknown[]>(
  action: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await action(...args);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  };
}

program
  .name('orch')
  .description('Orchestration CLI for parallel Claude Code workers')
  .version('0.1.0');

// spawn command
program
  .command('spawn <issue>')
  .description('Spawn a new worker for a GitHub issue')
  .action(withErrorHandling(async (issue: string) => {
    await spawnCommand(parseInt(issue, 10));
  }));

// list command
program
  .command('list')
  .alias('ls')
  .description('List all active sessions')
  .option('-a, --all', 'Include completed and cancelled sessions')
  .option('--json', 'Output as JSON')
  .action(withErrorHandling(listCommand));

// get command
program
  .command('get <session>')
  .description('Get details of a specific session')
  .option('--json', 'Output as JSON')
  .action(withErrorHandling(getCommand));

// update command
program
  .command('update')
  .description('Update session status')
  .requiredOption('--id <session>', 'Session ID')
  .requiredOption('--status <status>', 'New status')
  .option('--reason <reason>', 'Reason for stuck status')
  .option('--pr <url>', 'Pull request URL')
  .action(withErrorHandling(updateCommand));

// forward command
program
  .command('forward <session> <message>')
  .description('Forward guidance to a worker')
  .action(withErrorHandling(forwardCommand));

// cancel command
program
  .command('cancel <session>')
  .description('Cancel a session')
  .option('--keep-worktree', 'Keep the worktree for debugging')
  .action(withErrorHandling(cancelCommand));

// cancel-all command
program
  .command('cancel-all')
  .description('Cancel all active sessions')
  .option('--keep-worktrees', 'Keep worktrees for debugging')
  .action(withErrorHandling(async (options: { keepWorktrees?: boolean }) => {
    const { createSessionService } = await import('@ppds-orchestration/core');
    const service = await createSessionService();
    const count = await service.cancelAll({ keepWorktrees: options.keepWorktrees });
    console.log(chalk.yellow(`Cancelled ${count} session(s)`));
  }));

// heartbeat command
program
  .command('heartbeat')
  .description('Send a heartbeat for a session')
  .requiredOption('--id <session>', 'Session ID')
  .option('-q, --quiet', 'Suppress output (for automated use)')
  .action(withErrorHandling(async (options: { id: string; quiet?: boolean }) => {
    await heartbeatCommand(options.id, { quiet: options.quiet });
  }));

// ack command
program
  .command('ack <session>')
  .description('Acknowledge a forwarded message')
  .action(withErrorHandling(ackCommand));

// pause command
program
  .command('pause <session>')
  .description('Pause a session')
  .action(withErrorHandling(pauseCommand));

// resume command
program
  .command('resume <session>')
  .description('Resume a paused session')
  .action(withErrorHandling(resumeCommand));

// dashboard command
program
  .command('dashboard')
  .description('Launch the orchestration dashboard')
  .option('-o, --open', 'Open browser automatically')
  .option('-p, --port <port>', 'Port to run on (overrides config)')
  .action(withErrorHandling(async (options: { open?: boolean; port?: string }) => {
    await dashboardCommand({
      open: options.open,
      port: options.port ? parseInt(options.port, 10) : undefined,
    });
  }));

program.parse();
