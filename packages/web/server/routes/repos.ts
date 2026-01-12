import { Router, Request, Response } from 'express';
import { MultiRepoService } from '../services/multi-repo-service.js';

export const reposRouter = Router();

/**
 * GET /api/repos
 * List all configured repos with session counts.
 */
reposRouter.get('/', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const repos = service.listRepos();
    const stats = await service.getStats();

    const reposWithStats = repos.map((repo) => ({
      ...repo,
      sessionCounts: stats.byRepo[repo.id] ?? {
        active: 0,
        stuck: 0,
        complete: 0,
      },
    }));

    res.json({ repos: reposWithStats });
  } catch (error) {
    console.error('Error listing repos:', error);
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

/**
 * GET /api/repos/:repoId
 * Get details for a specific repo.
 */
reposRouter.get('/:repoId', async (req: Request, res: Response) => {
  try {
    const service: MultiRepoService = req.app.locals.multiRepoService;
    const { repoId } = req.params;

    const repos = service.listRepos();
    const repo = repos.find((r) => r.id === repoId);

    if (!repo) {
      return res.status(404).json({ error: 'Repo not found' });
    }

    const sessions = await service.listAllSessions({
      repoIds: [repoId],
      includeCompleted: true,
    });

    res.json({ repo, sessions });
  } catch (error) {
    console.error('Error getting repo:', error);
    res.status(500).json({ error: 'Failed to get repo' });
  }
});
