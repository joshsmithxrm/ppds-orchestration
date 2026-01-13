import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { sessionsRouter } from './sessions.js';

// Mock services
const mockMultiRepoService = {
  listAllSessions: vi.fn(),
  getSessionWithStatus: vi.fn(),
  spawn: vi.fn(),
  forward: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  delete: vi.fn(),
  updateStatus: vi.fn(),
};

const mockRalphManager = {
  startLoop: vi.fn(),
};

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.locals.multiRepoService = mockMultiRepoService;
  app.locals.ralphManager = mockRalphManager;
  app.use('/api/sessions', sessionsRouter);
  return app;
}

describe('Sessions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/sessions', () => {
    it('returns all sessions', async () => {
      const mockSessions = [
        { id: '1', issueNumber: 1, status: 'working' },
        { id: '2', issueNumber: 2, status: 'stuck' },
      ];
      mockMultiRepoService.listAllSessions.mockResolvedValue(mockSessions);

      const app = createApp();
      const response = await request(app).get('/api/sessions');

      expect(response.status).toBe(200);
      expect(response.body.sessions).toEqual(mockSessions);
      expect(response.body.total).toBe(2);
    });

    it('filters by repo when provided', async () => {
      mockMultiRepoService.listAllSessions.mockResolvedValue([]);

      const app = createApp();
      await request(app).get('/api/sessions?repo=repo-1,repo-2');

      expect(mockMultiRepoService.listAllSessions).toHaveBeenCalledWith({
        repoIds: ['repo-1', 'repo-2'],
        includeCompleted: false,
      });
    });

    it('includes completed when requested', async () => {
      mockMultiRepoService.listAllSessions.mockResolvedValue([]);

      const app = createApp();
      await request(app).get('/api/sessions?includeCompleted=true');

      expect(mockMultiRepoService.listAllSessions).toHaveBeenCalledWith({
        repoIds: undefined,
        includeCompleted: true,
      });
    });

    it('returns 500 on error', async () => {
      mockMultiRepoService.listAllSessions.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const response = await request(app).get('/api/sessions');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to list sessions');
    });
  });

  describe('GET /api/sessions/:repoId/:sessionId', () => {
    it('returns session details', async () => {
      const mockSession = {
        id: '123',
        issueNumber: 123,
        status: 'working',
      };
      mockMultiRepoService.getSessionWithStatus.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app).get('/api/sessions/repo-1/123');

      expect(response.status).toBe(200);
      expect(response.body.session).toEqual(mockSession);
      expect(response.body.repoId).toBe('repo-1');
    });

    it('returns 404 when session not found', async () => {
      mockMultiRepoService.getSessionWithStatus.mockResolvedValue(null);

      const app = createApp();
      const response = await request(app).get('/api/sessions/repo-1/999');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('POST /api/sessions/:repoId', () => {
    it('spawns a new session with single issueNumber (backwards compat)', async () => {
      const mockSession = {
        id: '123',
        issueNumber: 123,
        status: 'registered',
      };
      mockMultiRepoService.spawn.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app)
        .post('/api/sessions/repo-1')
        .send({ issueNumber: 123 });

      expect(response.status).toBe(201);
      expect(response.body.session).toEqual(mockSession);
      // API normalizes single issueNumber to array
      expect(mockMultiRepoService.spawn).toHaveBeenCalledWith('repo-1', [123], 'single');
    });

    it('spawns a new session with issueNumbers array', async () => {
      const mockSession = {
        id: '1',
        issues: [
          { number: 1, title: 'Issue 1' },
          { number: 2, title: 'Issue 2' },
          { number: 3, title: 'Issue 3' },
        ],
        status: 'registered',
      };
      mockMultiRepoService.spawn.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app)
        .post('/api/sessions/repo-1')
        .send({ issueNumbers: [1, 2, 3] });

      expect(response.status).toBe(201);
      expect(response.body.session).toEqual(mockSession);
      expect(mockMultiRepoService.spawn).toHaveBeenCalledWith('repo-1', [1, 2, 3], 'single');
    });

    it('spawns with ralph mode and starts loop', async () => {
      const mockSession = {
        id: '123',
        issueNumber: 123,
        status: 'registered',
      };
      mockMultiRepoService.spawn.mockResolvedValue(mockSession);
      mockRalphManager.startLoop.mockResolvedValue(undefined);

      const app = createApp();
      const response = await request(app)
        .post('/api/sessions/repo-1')
        .send({ issueNumber: 123, mode: 'ralph', iterations: 5 });

      expect(response.status).toBe(201);
      expect(mockRalphManager.startLoop).toHaveBeenCalledWith('repo-1', '123', { iterations: 5 });
    });

    it('returns 400 when issueNumber missing', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/sessions/repo-1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('issueNumber or issueNumbers is required');
    });

    it('returns 400 when issueNumber is not a number', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/sessions/repo-1')
        .send({ issueNumber: 'abc' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('issueNumber or issueNumbers is required');
    });

    it('returns 400 when issueNumbers contains non-positive numbers', async () => {
      const app = createApp();
      const response = await request(app)
        .post('/api/sessions/repo-1')
        .send({ issueNumbers: [1, 0, -1] });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('issueNumbers must be an array of positive numbers');
    });
  });

  describe('PATCH /api/sessions/:repoId/:sessionId', () => {
    it('forwards a message', async () => {
      const mockSession = {
        id: '123',
        forwardedMessage: 'Test message',
      };
      mockMultiRepoService.forward.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'forward', message: 'Test message' });

      expect(response.status).toBe(200);
      expect(mockMultiRepoService.forward).toHaveBeenCalledWith('repo-1', '123', 'Test message');
    });

    it('returns 400 when message missing for forward', async () => {
      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'forward' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('message is required for forward action');
    });

    it('pauses a session', async () => {
      const mockSession = { id: '123', status: 'paused' };
      mockMultiRepoService.pause.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'pause' });

      expect(response.status).toBe(200);
      expect(mockMultiRepoService.pause).toHaveBeenCalledWith('repo-1', '123');
    });

    it('resumes a session', async () => {
      const mockSession = { id: '123', status: 'working' };
      mockMultiRepoService.resume.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'resume' });

      expect(response.status).toBe(200);
      expect(mockMultiRepoService.resume).toHaveBeenCalledWith('repo-1', '123');
    });

    it('cancels a session', async () => {
      mockMultiRepoService.delete.mockResolvedValue(undefined);

      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'cancel' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockMultiRepoService.delete).toHaveBeenCalledWith('repo-1', '123');
    });

    it('updates session status', async () => {
      const mockSession = { id: '123', status: 'stuck' };
      mockMultiRepoService.updateStatus.mockResolvedValue(mockSession);

      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'update', status: 'stuck', reason: 'Need help' });

      expect(response.status).toBe(200);
      expect(mockMultiRepoService.updateStatus).toHaveBeenCalledWith(
        'repo-1',
        '123',
        'stuck',
        { reason: 'Need help', prUrl: undefined }
      );
    });

    it('returns 400 for unknown action', async () => {
      const app = createApp();
      const response = await request(app)
        .patch('/api/sessions/repo-1/123')
        .send({ action: 'unknown' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unknown action: unknown');
    });
  });

  describe('DELETE /api/sessions/:repoId/:sessionId', () => {
    it('deletes a session', async () => {
      mockMultiRepoService.delete.mockResolvedValue(undefined);

      const app = createApp();
      const response = await request(app).delete('/api/sessions/repo-1/123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockMultiRepoService.delete).toHaveBeenCalledWith('repo-1', '123', false);
    });

    it('keeps worktree when requested', async () => {
      mockMultiRepoService.delete.mockResolvedValue(undefined);

      const app = createApp();
      const response = await request(app).delete('/api/sessions/repo-1/123?keepWorktree=true');

      expect(response.status).toBe(200);
      expect(mockMultiRepoService.delete).toHaveBeenCalledWith('repo-1', '123', true);
    });
  });
});
