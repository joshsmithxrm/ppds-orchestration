import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { reposRouter } from './repos.js';

// Mock services
const mockMultiRepoService = {
  listRepos: vi.fn(),
  getStats: vi.fn(),
  listAllSessions: vi.fn(),
};

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.locals.multiRepoService = mockMultiRepoService;
  app.use('/api/repos', reposRouter);
  return app;
}

describe('Repos API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/repos', () => {
    it('returns all repos with session counts', async () => {
      const mockRepos = [
        { id: 'repo-1', config: { path: '/path/to/repo-1' } },
        { id: 'repo-2', config: { path: '/path/to/repo-2' } },
      ];
      const mockStats = {
        byRepo: {
          'repo-1': { active: 2, stuck: 1, complete: 3 },
          'repo-2': { active: 0, stuck: 0, complete: 1 },
        },
      };

      mockMultiRepoService.listRepos.mockReturnValue(mockRepos);
      mockMultiRepoService.getStats.mockResolvedValue(mockStats);

      const app = createApp();
      const response = await request(app).get('/api/repos');

      expect(response.status).toBe(200);
      expect(response.body.repos).toHaveLength(2);
      expect(response.body.repos[0]).toEqual({
        id: 'repo-1',
        config: { path: '/path/to/repo-1' },
        sessionCounts: { active: 2, stuck: 1, complete: 3 },
      });
      expect(response.body.repos[1]).toEqual({
        id: 'repo-2',
        config: { path: '/path/to/repo-2' },
        sessionCounts: { active: 0, stuck: 0, complete: 1 },
      });
    });

    it('returns empty counts for repos without stats', async () => {
      const mockRepos = [{ id: 'repo-1', config: { path: '/path/to/repo-1' } }];
      const mockStats = { byRepo: {} };

      mockMultiRepoService.listRepos.mockReturnValue(mockRepos);
      mockMultiRepoService.getStats.mockResolvedValue(mockStats);

      const app = createApp();
      const response = await request(app).get('/api/repos');

      expect(response.status).toBe(200);
      expect(response.body.repos[0].sessionCounts).toEqual({
        active: 0,
        stuck: 0,
        complete: 0,
      });
    });

    it('returns 500 on error', async () => {
      mockMultiRepoService.listRepos.mockImplementation(() => {
        throw new Error('Config error');
      });

      const app = createApp();
      const response = await request(app).get('/api/repos');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list repos');
    });
  });

  describe('GET /api/repos/:repoId', () => {
    it('returns repo details with sessions', async () => {
      const mockRepos = [
        { id: 'repo-1', config: { path: '/path/to/repo-1' } },
        { id: 'repo-2', config: { path: '/path/to/repo-2' } },
      ];
      const mockSessions = [
        { id: '1', issueNumber: 1, status: 'working' },
        { id: '2', issueNumber: 2, status: 'complete' },
      ];

      mockMultiRepoService.listRepos.mockReturnValue(mockRepos);
      mockMultiRepoService.listAllSessions.mockResolvedValue(mockSessions);

      const app = createApp();
      const response = await request(app).get('/api/repos/repo-1');

      expect(response.status).toBe(200);
      expect(response.body.repo).toEqual({
        id: 'repo-1',
        config: { path: '/path/to/repo-1' },
      });
      expect(response.body.sessions).toEqual(mockSessions);
      expect(mockMultiRepoService.listAllSessions).toHaveBeenCalledWith({
        repoIds: ['repo-1'],
        includeCompleted: true,
      });
    });

    it('returns 404 when repo not found', async () => {
      mockMultiRepoService.listRepos.mockReturnValue([]);

      const app = createApp();
      const response = await request(app).get('/api/repos/unknown-repo');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Repo not found');
    });

    it('returns 500 on error', async () => {
      mockMultiRepoService.listRepos.mockImplementation(() => {
        throw new Error('Config error');
      });

      const app = createApp();
      const response = await request(app).get('/api/repos/repo-1');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get repo');
    });
  });
});
