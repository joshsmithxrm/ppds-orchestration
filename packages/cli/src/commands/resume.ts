import chalk from 'chalk';
import { createSessionService, SessionState } from '@ppds-orchestration/core';

function formatIssues(session: SessionState): string {
  return session.issues.map(i => `#${i.number}`).join(', ');
}

export async function resumeCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();

  // Get session first to check if it's paused
  const before = await service.get(sessionId);
  if (!before) {
    throw new Error(`Session '${sessionId}' not found`);
  }

  if (before.status !== 'paused') {
    console.log(chalk.dim(`Session ${formatIssues(before)} is not paused (status: ${before.status})`));
    return;
  }

  const session = await service.resume(sessionId);

  console.log(chalk.green(`\u25B6 Resumed session ${formatIssues(session)}`));
}
