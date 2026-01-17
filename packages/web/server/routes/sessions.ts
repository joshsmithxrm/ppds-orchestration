import { Router, Request, Response } from 'express';
import { MultiRepoService } from '../services/multi-repo-service.js';
import { RalphLoopManager } from '../services/ralph-loop-manager.js';
import { SessionStatus, ExecutionMode, SessionState } from '@ppds-orchestration/core';

export const sessionsRouter = Router();

// ============================================
// IMPORTANT: /orphans routes MUST come before /:repoId routes
// Otherwise Express matches 'orphans' as a repoId parameter
// ============================================

/**
 * GET /api/sessions/orphans
 * List all detected orphaned worktrees across all repos.
 */
sessionsRouter.get('/orphans', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const orphans = await service.reconcileOrphans();
    res.json({ orphans, count: orphans.length });
  } catch (error) {
    console.error('Error listing orphans:', error);
    res.status(500).json({ error: 'Failed to list orphans' });
  }
});

/**
 * DELETE /api/sessions/orphans/:repoId
 * Clean up an orphaned worktree.
 * Body: { worktreePath: string }
 */
sessionsRouter.delete('/orphans/:repoId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId } = req.params;
    const { worktreePath } = req.body;

    if (!worktreePath) {
      return res.status(400).json({ error: 'worktreePath is required' });
    }

    const result = await service.cleanupOrphan(repoId, worktreePath);

    if (!result.success) {
      return res.status(409).json({
        error: result.error,
        cleanupFailed: true,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error cleaning up orphan:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to cleanup orphan',
    });
  }
});

// ============================================
// Regular session routes
// ============================================

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
 * Spawn new worker session(s).
 * Body: { issueNumber?: number, issueNumbers?: number[], mode?: 'manual' | 'autonomous', iterations?: number }
 * - issueNumbers: Array of issue numbers (each spawns as separate session)
 * - issueNumber: Single issue number (backwards compatibility)
 */
sessionsRouter.post('/:repoId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const ralphManager: RalphLoopManager = req.app.locals.ralphManager;
    const { repoId } = req.params;
    const { issueNumber, issueNumbers, mode = 'manual', iterations } = req.body;

    // Normalize: prefer issueNumbers array, fall back to single issueNumber
    let issues: number[];
    if (issueNumbers && Array.isArray(issueNumbers) && issueNumbers.length > 0) {
      // Validate all elements are numbers
      if (!issueNumbers.every((n: unknown) => typeof n === 'number' && n > 0)) {
        return res.status(400).json({ error: 'issueNumbers must be an array of positive numbers' });
      }
      issues = issueNumbers;
    } else if (typeof issueNumber === 'number' && issueNumber > 0) {
      issues = [issueNumber];
    } else {
      return res.status(400).json({ error: 'issueNumber or issueNumbers is required' });
    }

    // Spawn each issue as a separate session
    const sessions: SessionState[] = [];
    for (const issue of issues) {
      const session = await service.spawn(repoId, issue, mode as ExecutionMode);
      sessions.push(session);

      // Start autonomous loop if mode is 'autonomous'
      if (mode === 'autonomous') {
        const options = iterations ? { iterations } : undefined;
        await ralphManager.startLoop(repoId, session.id, options);
      }
    }

    // Return the last session for backwards compatibility, but also include all sessions
    const session = sessions[sessions.length - 1];
    res.status(201).json({ session, sessions, repoId });
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
        await service.delete(repoId, sessionId);
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
 * Query params:
 *   - keepWorktree=true: Don't remove worktree
 *   - force=true: Delete session even if worktree cleanup fails
 */
sessionsRouter.delete('/:repoId/:sessionId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId, sessionId } = req.params;
    const keepWorktree = req.query.keepWorktree === 'true';
    const force = req.query.force === 'true';

    const result = await service.delete(repoId, sessionId, { keepWorktree, force });

    if (!result.success && !force) {
      // Return 409 Conflict for deletion failures
      return res.status(409).json({
        error: result.error,
        deletionFailed: true,
        orphanedWorktreePath: result.orphanedWorktreePath,
        canRetry: true,
        canForce: true,
      });
    }

    res.json({
      success: result.success,
      worktreeRemoved: result.worktreeRemoved,
      orphanedWorktreePath: result.orphanedWorktreePath,
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to delete session',
    });
  }
});

/**
 * PATCH /api/sessions/:repoId/:sessionId/retry-delete
 * Retry deletion for a session in deletion_failed state.
 */
sessionsRouter.patch('/:repoId/:sessionId/retry-delete', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId, sessionId } = req.params;

    const result = await service.retryDelete(repoId, sessionId);

    if (!result.success) {
      return res.status(409).json({
        error: result.error,
        deletionFailed: true,
        canRetry: true,
        canForce: true,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error retrying deletion:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to retry deletion',
    });
  }
});

/**
 * PATCH /api/sessions/:repoId/:sessionId/rollback-delete
 * Rollback a deletion_failed session to its previous state.
 */
sessionsRouter.patch('/:repoId/:sessionId/rollback-delete', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId, sessionId } = req.params;

    const session = await service.rollbackDeletion(repoId, sessionId);
    res.json({ session, repoId });
  } catch (error) {
    console.error('Error rolling back deletion:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to rollback deletion',
    });
  }
});

