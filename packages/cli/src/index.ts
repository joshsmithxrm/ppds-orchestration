#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { spawnCommand } from './commands/spawn.js';
import { listCommand } from './commands/list.js';
import { getCommand } from './commands/get.js';
import { updateCommand } from './commands/update.js';
import { cancelCommand } from './commands/cancel.js';
import { heartbeatCommand } from './commands/heartbeat.js';
import { pauseCommand } from './commands/pause.js';
import { resumeCommand } from './commands/resume.js';
import { restartCommand } from './commands/restart.js';
import { deleteCommand } from './commands/delete.js';
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

// spawn command - accepts one or more issue numbers
program
  .command('spawn <issues...>')
  .description('Spawn a new worker for GitHub issue(s)')
  .option('--phase <phase>', 'Phase: planning (default) or building', 'planning')
  .action(withErrorHandling(async (issues: string[], options: { phase?: string }) => {
    // Validate issue numbers
    const parsedIssues = issues.map(i => parseInt(i, 10));
    const invalidIssues = issues.filter((_, i) => Number.isNaN(parsedIssues[i]));
    if (invalidIssues.length > 0) {
      throw new Error(`Invalid issue number(s): ${invalidIssues.join(', ')}. Issue numbers must be numeric.`);
    }
    // Validate phase
    const phase = options.phase as 'planning' | 'building' | undefined;
    if (phase && phase !== 'planning' && phase !== 'building') {
      throw new Error(`Invalid phase '${phase}'. Must be 'planning' or 'building'.`);
    }
    await spawnCommand(parsedIssues, { phase });
  }));

// list command
program
  .command('list')
  .alias('ls')
  .description('List all sessions')
  .option('-a, --all', 'Include completed and cancelled sessions (deprecated, now default)')
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

// cancel command
program
  .command('cancel <session>')
  .description('Cancel a session')
  .action(withErrorHandling(cancelCommand));

// delete-all command (formerly cancel-all)
program
  .command('delete-all')
  .alias('cancel-all')
  .description('Delete all active sessions')
  .option('--mode <mode>', 'Deletion mode: folder-only, with-local-branch, everything')
  .action(withErrorHandling(async (options: { mode?: string }) => {
    const { createSessionService, isTerminalStatus } = await import('@ppds-orchestration/core');
    const service = await createSessionService();
    const sessions = await service.list();
    const activeSessions = sessions.filter(s => !isTerminalStatus(s.status));
    const deletionMode = (options.mode ?? 'folder-only') as 'folder-only' | 'with-local-branch' | 'everything';
    let count = 0;
    for (const session of activeSessions) {
      await service.delete(session.id, { deletionMode });
      count++;
    }
    console.log(chalk.yellow(`Deleted ${count} session(s)`));
  }));

// heartbeat command
program
  .command('heartbeat <session>')
  .description('Send a heartbeat for a session')
  .option('-q, --quiet', 'Suppress output (for automated use)')
  .action(withErrorHandling(async (session: string, options: { quiet?: boolean }) => {
    await heartbeatCommand(session, { quiet: options.quiet });
  }));

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

// restart command
program
  .command('restart <session>')
  .description('Restart a stuck session with a fresh worker')
  .action(withErrorHandling(restartCommand));

// delete command
program
  .command('delete <session>')
  .description('Delete a session from the list')
  .option('--mode <mode>', 'Deletion mode: folder-only, with-local-branch, everything')
  .action(withErrorHandling(deleteCommand));

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
