import chalk from 'chalk';
import { createSessionService, SessionState } from '@ppds-orchestration/core';

function formatIssues(session: SessionState): string {
  return session.issues.map(i => `#${i.number}`).join(', ');
}

export async function ackCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();
  const session = await service.acknowledgeMessage(sessionId);
  console.log(chalk.green(`\u2713 Message acknowledged for session ${formatIssues(session)}`));
}
