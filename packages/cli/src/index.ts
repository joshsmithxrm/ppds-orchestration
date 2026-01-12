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

const program = new Command();

program
  .name('orch')
  .description('Orchestration CLI for parallel Claude Code workers')
  .version('0.1.0');

// spawn command
program
  .command('spawn <issue>')
  .description('Spawn a new worker for a GitHub issue')
  .action(async (issue: string) => {
    try {
      await spawnCommand(parseInt(issue, 10));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// list command
program
  .command('list')
  .alias('ls')
  .description('List all active sessions')
  .option('-a, --all', 'Include completed and cancelled sessions')
  .option('--json', 'Output as JSON')
  .action(async (options: { all?: boolean; json?: boolean }) => {
    try {
      await listCommand(options);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// get command
program
  .command('get <session>')
  .description('Get details of a specific session')
  .option('--json', 'Output as JSON')
  .action(async (session: string, options: { json?: boolean }) => {
    try {
      await getCommand(session, options);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// update command
program
  .command('update')
  .description('Update session status')
  .requiredOption('--id <session>', 'Session ID')
  .requiredOption('--status <status>', 'New status')
  .option('--reason <reason>', 'Reason for stuck status')
  .option('--pr <url>', 'Pull request URL')
  .action(async (options: { id: string; status: string; reason?: string; pr?: string }) => {
    try {
      await updateCommand(options);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// forward command
program
  .command('forward <session> <message>')
  .description('Forward guidance to a worker')
  .action(async (session: string, message: string) => {
    try {
      await forwardCommand(session, message);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// cancel command
program
  .command('cancel <session>')
  .description('Cancel a session')
  .option('--keep-worktree', 'Keep the worktree for debugging')
  .action(async (session: string, options: { keepWorktree?: boolean }) => {
    try {
      await cancelCommand(session, options);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// cancel-all command
program
  .command('cancel-all')
  .description('Cancel all active sessions')
  .option('--keep-worktrees', 'Keep worktrees for debugging')
  .action(async (options: { keepWorktrees?: boolean }) => {
    try {
      const { createSessionService } = await import('@ppds-orchestration/core');
      const service = await createSessionService();
      const count = await service.cancelAll({ keepWorktrees: options.keepWorktrees });
      console.log(chalk.yellow(`Cancelled ${count} session(s)`));
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// heartbeat command
program
  .command('heartbeat')
  .description('Send a heartbeat for a session')
  .requiredOption('--id <session>', 'Session ID')
  .option('-q, --quiet', 'Suppress output (for automated use)')
  .action(async (options: { id: string; quiet?: boolean }) => {
    try {
      await heartbeatCommand(options.id, { quiet: options.quiet });
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ack command
program
  .command('ack <session>')
  .description('Acknowledge a forwarded message')
  .action(async (session: string) => {
    try {
      await ackCommand(session);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// pause command
program
  .command('pause <session>')
  .description('Pause a session')
  .action(async (session: string) => {
    try {
      await pauseCommand(session);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// resume command
program
  .command('resume <session>')
  .description('Resume a paused session')
  .action(async (session: string) => {
    try {
      await resumeCommand(session);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// dashboard command (placeholder)
program
  .command('dashboard')
  .description('Launch the orchestration dashboard')
  .action(() => {
    console.log(chalk.yellow('Dashboard not yet implemented. Coming soon!'));
    process.exit(0);
  });

program.parse();
