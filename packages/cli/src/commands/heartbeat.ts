import { createSessionService } from '@ppds-orchestration/core';

export async function heartbeatCommand(sessionId: string): Promise<void> {
  const service = await createSessionService();
  await service.heartbeat(sessionId);
  // Silent success - heartbeats are meant to be quiet
}
