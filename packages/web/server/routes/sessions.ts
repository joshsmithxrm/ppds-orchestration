import { Router, Request, Response } from 'express';
import { MultiRepoService } from '../services/multi-repo-service.js';
import { SessionStatus, ExecutionMode } from '@ppds-orchestration/core';

export const sessionsRouter = Router();

/**
 * GET /api/sessions
 * List all sessions across all repos.
 */
sessionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const includeCompleted = req.query.includeCompleted === 'true';
    const repoIds = req.query.repo
      ? (req.query.repo as string).split(',')
      : undefined;

    const sessions = await service.listAllSessions({
      repoIds,
      includeCompleted,
    });

    res.json({ sessions, total: sessions.length });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/**
 * GET /api/sessions/:repoId/:sessionId
 * Get a specific session with details.
 */
sessionsRouter.get('/:repoId/:sessionId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId, sessionId } = req.params;

    const session = await service.getSessionWithStatus(repoId, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session, repoId });
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * POST /api/sessions/:repoId
 * Spawn a new worker session.
 */
sessionsRouter.post('/:repoId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId } = req.params;
    const { issueNumber, mode = 'single' } = req.body;

    if (!issueNumber || typeof issueNumber !== 'number') {
      return res.status(400).json({ error: 'issueNumber is required' });
    }

    const session = await service.spawn(
      repoId,
      issueNumber,
      mode as ExecutionMode
    );

    res.status(201).json({ session, repoId });
  } catch (error) {
    console.error('Error spawning session:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to spawn session',
    });
  }
});

/**
 * PATCH /api/sessions/:repoId/:sessionId
 * Update session (forward message, pause, resume, cancel).
 */
sessionsRouter.patch('/:repoId/:sessionId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId, sessionId } = req.params;
    const { action, message, status, reason, prUrl } = req.body;

    let session;

    switch (action) {
      case 'forward':
        if (!message) {
          return res.status(400).json({ error: 'message is required for forward action' });
        }
        session = await service.forward(repoId, sessionId, message);
        break;

      case 'pause':
        session = await service.pause(repoId, sessionId);
        break;

      case 'resume':
        session = await service.resume(repoId, sessionId);
        break;

      case 'cancel':
        await service.cancel(repoId, sessionId);
        return res.json({ success: true });

      case 'update':
        if (!status) {
          return res.status(400).json({ error: 'status is required for update action' });
        }
        session = await service.updateStatus(repoId, sessionId, status as SessionStatus, {
          reason,
          prUrl,
        });
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    res.json({ session, repoId });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update session',
    });
  }
});

/**
 * DELETE /api/sessions/:repoId/:sessionId
 * Cancel and remove a session.
 */
sessionsRouter.delete('/:repoId/:sessionId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId, sessionId } = req.params;
    const keepWorktree = req.query.keepWorktree === 'true';

    await service.cancel(repoId, sessionId, keepWorktree);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to delete session',
    });
  }
});
