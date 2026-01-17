import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionView from './SessionView';

const mockSession = {
  id: '123',
  repoId: 'test-repo',
  issueNumber: 123,
  issueTitle: 'Test Issue',
  status: 'working',
  mode: 'manual',
  branch: 'issue-123',
  worktreePath: '/path/to/worktree',
  startedAt: new Date().toISOString(),
  lastHeartbeat: new Date().toISOString(),
  worktreeStatus: {
    filesChanged: 5,
    insertions: 100,
    deletions: 20,
    lastCommitMessage: 'feat: add new feature',
    changedFiles: ['file1.ts', 'file2.ts', 'file3.ts'],
  },
};

function renderSessionView(repoId = 'test-repo', sessionId = '123') {
  return render(
    <MemoryRouter initialEntries={[`/session/${repoId}/${sessionId}`]}>
      <Routes>
        <Route path="/session/:repoId/:sessionId" element={<SessionView />} />
        <Route path="/" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SessionView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    renderSessionView();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows 404 when session not found', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByText(/Session not found/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Back to dashboard/i)).toBeInTheDocument();
  });

  it('shows session details when loaded', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: mockSession }),
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByText('test-repo #123')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Issue')).toBeInTheDocument();
    expect(screen.getByText('issue-123')).toBeInTheDocument();
    expect(screen.getByText('/path/to/worktree')).toBeInTheDocument();
  });

  it('shows git status when available', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: mockSession }),
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByText('+100')).toBeInTheDocument();
    });

    expect(screen.getByText('-20')).toBeInTheDocument();
    expect(screen.getByText('5 files')).toBeInTheDocument();
    expect(screen.getByText(/feat: add new feature/i)).toBeInTheDocument();
    expect(screen.getByText('file1.ts')).toBeInTheDocument();
  });

  it('shows stuck reason when session is stuck', async () => {
    const stuckSession = {
      ...mockSession,
      status: 'stuck',
      stuckReason: 'Need auth decision',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: stuckSession }),
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByText('Stuck Reason')).toBeInTheDocument();
    });

    expect(screen.getByText('Need auth decision')).toBeInTheDocument();
  });

  it('handles pause action', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options) => {
      if (options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              session: { ...mockSession, status: 'paused' },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ session: mockSession }),
      });
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
    });

    const pauseButton = screen.getByRole('button', { name: /Pause/i });
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/test-repo/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'pause' }),
        })
      );
    });
  });

  it('shows resume button when paused', async () => {
    const pausedSession = {
      ...mockSession,
      status: 'paused',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: pausedSession }),
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    });
  });

  it('handles delete action', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, options) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ session: mockSession }),
      });
    });

    renderSessionView();

    // Wait for page to load and find the Delete button in the actions area
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Delete/i })[0]).toBeInTheDocument();
    });

    // Click the first Delete button (the one in the actions area, not in the dialog)
    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i });
    fireEvent.click(deleteButtons[0]);

    // Delete button opens a confirmation dialog
    await waitFor(() => {
      expect(screen.getByText('Delete Session')).toBeInTheDocument();
    });

    // Click the confirm button in the dialog (now there are two Delete buttons)
    const allDeleteButtons = screen.getAllByRole('button', { name: /Delete/i });
    // The dialog confirm button is the second one
    fireEvent.click(allDeleteButtons[1]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/test-repo/123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  it('shows Autonomous status for autonomous mode sessions', async () => {
    const autonomousSession = {
      ...mockSession,
      mode: 'autonomous',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/api/ralph')) {
        return Promise.resolve({
          ok: false,
          status: 404,
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ session: autonomousSession }),
      });
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByText('Autonomous')).toBeInTheDocument();
    });

    // RalphStatus component should render (still called RalphStatus internally)
    expect(screen.getByText('Ralph Loop')).toBeInTheDocument();
  });

  it('shows pull request link when available', async () => {
    const sessionWithPR = {
      ...mockSession,
      pullRequestUrl: 'https://github.com/owner/repo/pull/1',
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session: sessionWithPR }),
    });

    renderSessionView();

    await waitFor(() => {
      expect(screen.getByText('Pull Request')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: /github\.com/i });
    expect(link).toHaveAttribute('href', 'https://github.com/owner/repo/pull/1');
  });
});
