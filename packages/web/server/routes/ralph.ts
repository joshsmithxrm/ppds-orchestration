import { Router, Request, Response } from 'express';
import { RalphLoopManager } from '../services/ralph-loop-manager.js';

export const ralphRouter = Router();

/**
 * GET /api/ralph
 * List all active Ralph loops.
 */
ralphRouter.get('/', (req: Request, res: Response) => {
  try {
    const ralphManager: RalphLoopManager = req.app.locals.ralphManager;
    const loops = ralphManager.getActiveLoops();

    res.json({ loops });
  } catch (error) {
    console.error('Error listing Ralph loops:', error);
    res.status(500).json({ error: 'Failed to list Ralph loops' });
  }
});

/**
 * GET /api/ralph/:repoId/:sessionId
 * Get Ralph loop state for a session.
 */
ralphRouter.get('/:repoId/:sessionId', (req: Request, res: Response) => {
  try {
    const ralphManager: RalphLoopManager = req.app.locals.ralphManager;
    const { repoId, sessionId } = req.params;

    const state = ralphManager.getLoopState(repoId, sessionId);
    if (!state) {
      return res.status(404).json({ error: 'Ralph loop not found' });
    }

    res.json({ state });
  } catch (error) {
    console.error('Error getting Ralph loop state:', error);
    res.status(500).json({ error: 'Failed to get Ralph loop state' });
  }
});

/**
 * POST /api/ralph/:repoId/:sessionId/start
 * Start a Ralph loop for a session.
 * Body: { iterations?: number } - optional number of iterations (defaults to config value)
 */
ralphRouter.post('/:repoId/:sessionId/start', async (req: Request, res: Response) => {
  try {
    const ralphManager: RalphLoopManager = req.app.locals.ralphManager;
    const { repoId, sessionId } = req.params;
    const { iterations } = req.body as { iterations?: number };

    const options = iterations ? { iterations } : undefined;
    const state = await ralphManager.startLoop(repoId, sessionId, options);

    res.json({ state });
  } catch (error) {
    console.error('Error starting Ralph loop:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start Ralph loop',
    });
  }
});

/**
 * POST /api/ralph/:repoId/:sessionId/stop
 * Stop a Ralph loop.
 */
ralphRouter.post('/:repoId/:sessionId/stop', (req: Request, res: Response) => {
  try {
    const ralphManager: RalphLoopManager = req.app.locals.ralphManager;
    const { repoId, sessionId } = req.params;

    ralphManager.stopLoop(repoId, sessionId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error stopping Ralph loop:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to stop Ralph loop',
    });
  }
});

/**
 * POST /api/ralph/:repoId/:sessionId/continue
 * Continue to next iteration (when in waiting state).
 */
ralphRouter.post('/:repoId/:sessionId/continue', async (req: Request, res: Response) => {
  try {
    const ralphManager: RalphLoopManager = req.app.locals.ralphManager;
    const { repoId, sessionId } = req.params;

    await ralphManager.continueLoop(repoId, sessionId);

    const state = ralphManager.getLoopState(repoId, sessionId);
    res.json({ state });
  } catch (error) {
    console.error('Error continuing Ralph loop:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to continue Ralph loop',
    });
  }
});
