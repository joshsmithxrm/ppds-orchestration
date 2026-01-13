import chalk from 'chalk';
import { createSessionService, SessionState } from '@ppds-orchestration/core';

function formatIssues(session: SessionState): string {
  return session.issues.map(i => `#${i.number}`).join(', ');
}

export async function forwardCommand(sessionId: string, message: string): Promise<void> {
  const service = await createSessionService();
  const session = await service.forward(sessionId, message);

  console.log(chalk.green(`\u2713 Message forwarded to session ${formatIssues(session)}`));
  console.log(`  Message: ${message}`);
}
