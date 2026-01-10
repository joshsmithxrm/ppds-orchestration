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
  complete: '[✓]',
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
  complete: chalk.green,
  cancelled: chalk.gray,
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

function formatSession(session: SessionState): string {
  const icon = isStale(session) && session.status === 'working'
    ? chalk.yellow('[?]')
    : STATUS_COLORS[session.status]?.(STATUS_ICONS[session.status] ?? '[ ]') ?? '[ ]';

  const status = session.status.toUpperCase().replace('_', ' ');
  const elapsed = getElapsedTime(session.startedAt);

  let line = `${icon} #${session.issueNumber} - ${STATUS_COLORS[session.status]?.(status) ?? status} (${elapsed}) - ${session.issueTitle}`;

  if (session.stuckReason) {
    line += `\n    ${chalk.red('Reason:')} ${session.stuckReason}`;
  }

  if (session.pullRequestUrl) {
    line += `\n    ${chalk.blue('PR:')} ${session.pullRequestUrl}`;
  }

  line += `\n    Branch: ${session.branch}, Worktree: ${session.worktreePath}`;

  return line;
}

export async function listCommand(options: { all?: boolean; json?: boolean }): Promise<void> {
  const service = await createSessionService();
  const sessions = await service.list();

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (sessions.length === 0) {
    console.log(chalk.gray('No active sessions'));
    return;
  }

  console.log(chalk.bold(`Active Sessions (${sessions.length}):\n`));

  for (const session of sessions) {
    console.log(formatSession(session));
    console.log();
  }

  // Legend
  console.log(chalk.gray('Icons: [ ] registered, [~] planning, [P] plan ready, [*] working'));
  console.log(chalk.gray('       [!] stuck, [||] paused, [+] PR ready, [?] stale'));
}
