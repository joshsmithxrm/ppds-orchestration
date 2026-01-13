import chalk from 'chalk';
import { createSessionService } from '@ppds-orchestration/core';

export async function getCommand(sessionId: string, options: { json?: boolean }): Promise<void> {
  const service = await createSessionService();
  const session = await service.get(sessionId);

  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  if (options.json) {
    // Include worktree status in JSON output
    const worktreeStatus = await service.getWorktreeStatus(sessionId);
    console.log(JSON.stringify({ ...session, worktreeStatus }, null, 2));
    return;
  }

  // Get worktree status
  const worktreeStatus = await service.getWorktreeStatus(sessionId);

  // Format output
  const primaryIssue = session.issues[0];
  const issueDisplay = session.issues.length === 1
    ? `#${primaryIssue.number}: ${primaryIssue.title}`
    : `Issues ${session.issues.map(i => `#${i.number}`).join(', ')}`;

  console.log(chalk.bold(`Session ${issueDisplay}`));
  console.log();

  // Show all issues if multi-issue
  if (session.issues.length > 1) {
    console.log(chalk.bold('  Issues:'));
    for (const issue of session.issues) {
      console.log(`    #${issue.number}: ${issue.title}`);
    }
    console.log();
  }

  console.log(`  Status:      ${formatStatus(session.status)}`);
  console.log(`  Branch:      ${chalk.cyan(session.branch)}`);
  console.log(`  Worktree:    ${session.worktreePath}`);
  console.log(`  Started:     ${new Date(session.startedAt).toLocaleString()}`);
  console.log(`  Heartbeat:   ${new Date(session.lastHeartbeat).toLocaleString()}`);

  if (session.stuckReason) {
    console.log();
    console.log(chalk.red(`  Stuck: ${session.stuckReason}`));
  }

  if (session.forwardedMessage) {
    console.log();
    console.log(chalk.yellow(`  Forwarded: ${session.forwardedMessage}`));
  }

  if (session.pullRequestUrl) {
    console.log();
    console.log(chalk.blue(`  PR: ${session.pullRequestUrl}`));
  }

  if (worktreeStatus) {
    console.log();
    console.log(chalk.bold('  Git Status:'));
    console.log(`    Files changed: ${worktreeStatus.filesChanged}`);
    console.log(`    Insertions:    +${worktreeStatus.insertions}`);
    console.log(`    Deletions:     -${worktreeStatus.deletions}`);

    if (worktreeStatus.lastCommitMessage) {
      console.log(`    Last commit:   ${worktreeStatus.lastCommitMessage}`);
    }

    if (worktreeStatus.changedFiles.length > 0) {
      console.log(`    Changed files:`);
      for (const file of worktreeStatus.changedFiles) {
        console.log(`      - ${file}`);
      }
    }
  }
}

function formatStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
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

  const formatted = status.toUpperCase().replace('_', ' ');
  return colors[status]?.(formatted) ?? formatted;
}
