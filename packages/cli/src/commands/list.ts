import chalk from 'chalk';
import { createSessionService, SessionState, STALE_THRESHOLD_MS } from '@ppds-orchestration/core';

const STATUS_ICONS: Record<string, string> = {
  registered: '[ ]',
  planning: '[~]',
  planning_complete: '[P]',
  working: '[*]',
  shipping: '[>]',
  reviews_in_progress: '[R]',
  pr_ready: '[+]',
  stuck: '[!]',
  paused: '[||]',
  complete: '[\u2713]',
  cancelled: '[x]',
};

const STATUS_COLORS: Record<string, (s: string) => string> = {
  registered: chalk.gray,
  planning: chalk.blue,
  planning_complete: chalk.magenta,
  working: chalk.green,
  shipping: chalk.cyan,
  reviews_in_progress: chalk.cyan,
  pr_ready: chalk.greenBright,
  stuck: chalk.red,
  paused: chalk.yellow,
  complete: chalk.dim,
  cancelled: chalk.dim,
};

function getElapsedTime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const minutes = Math.floor((now - start) / 60000);

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h${remainingMinutes}m`;
}

function isStale(session: SessionState): boolean {
  const lastHeartbeat = new Date(session.lastHeartbeat).getTime();
  return Date.now() - lastHeartbeat > STALE_THRESHOLD_MS;
}

function formatIssues(session: SessionState): string {
  if (session.issues.length === 1) {
    return `#${session.issues[0].number}`;
  }
  return session.issues.map(i => `#${i.number}`).join(', ');
}

function formatTitle(session: SessionState): string {
  if (session.issues.length === 1) {
    return session.issues[0].title;
  }
  return `${session.issues.length} issues`;
}

function formatSession(session: SessionState): string {
  const isCompleted = session.status === 'complete' || session.status === 'cancelled';
  const colorFn = isCompleted ? chalk.dim : (s: string) => s;

  const icon = isStale(session) && session.status === 'working'
    ? chalk.yellow('[?]')
    : STATUS_COLORS[session.status]?.(STATUS_ICONS[session.status] ?? '[ ]') ?? '[ ]';

  const status = session.status.toUpperCase().replace('_', ' ');
  const elapsed = getElapsedTime(session.startedAt);
  const issues = formatIssues(session);
  const title = formatTitle(session);

  let line = colorFn(`${icon} ${issues} - ${STATUS_COLORS[session.status]?.(status) ?? status} (${elapsed}) - ${title}`);

  if (session.stuckReason) {
    line += `\n    ${chalk.red('Reason:')} ${session.stuckReason}`;
  }

  if (session.pullRequestUrl) {
    line += `\n    ${chalk.blue('PR:')} ${session.pullRequestUrl}`;
  }

  line += colorFn(`\n    Branch: ${session.branch}, Worktree: ${session.worktreePath}`);

  return line;
}

export async function listCommand(options: { all?: boolean; json?: boolean }): Promise<void> {
  const service = await createSessionService();

  // By default, show all sessions including completed
  // Use --active to filter to only running sessions
  const sessions = await service.list();

  // Filter based on options (--all is deprecated, keeping for backward compat)
  // Now we show all by default, so --all does nothing
  // Could add --active flag to show only running

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (sessions.length === 0) {
    console.log(chalk.gray('No sessions'));
    return;
  }

  // Separate running and completed sessions
  const running = sessions.filter(s => s.status !== 'complete' && s.status !== 'cancelled');
  const completed = sessions.filter(s => s.status === 'complete' || s.status === 'cancelled');

  if (running.length > 0) {
    console.log(chalk.bold(`Active Sessions (${running.length}):\n`));
    for (const session of running) {
      console.log(formatSession(session));
      console.log();
    }
  }

  if (completed.length > 0) {
    console.log(chalk.dim(`\nCompleted Sessions (${completed.length}):\n`));
    for (const session of completed) {
      console.log(formatSession(session));
      console.log();
    }
  }

  // Legend
  console.log(chalk.gray('Icons: [ ] registered, [~] planning, [P] plan ready, [*] working'));
  console.log(chalk.gray('       [!] stuck, [||] paused, [+] PR ready, [?] stale'));
  console.log(chalk.gray('       [\u2713] complete, [x] cancelled'));
}
