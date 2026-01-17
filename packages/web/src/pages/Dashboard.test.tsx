import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Dashboard from './Dashboard';

// Mock the context hooks
vi.mock('../App', () => ({
  useSoundsContext: () => ({
    enabled: true,
    toggle: vi.fn(),
    playOnSpawn: vi.fn(),
    playOnStuck: vi.fn(),
    playOnComplete: vi.fn(),
  }),
  useConfigContext: () => ({
    sounds: {},
  }),
}));

const mockSessions = [
  {
    id: '1',
    repoId: 'repo-1',
    issueNumber: 1,
    issueTitle: 'Test Issue 1',
    status: 'working',
    mode: 'manual',
    branch: 'issue-1',
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  },
];

const mockRepos = [
  {
    id: 'repo-1',
    config: { path: '/path/to/repo' },
    sessionCounts: { active: 1, stuck: 0, complete: 0 },
  },
];

function renderDashboard() {
  return render(
    <BrowserRouter>
      <Dashboard />
    </BrowserRouter>
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    renderDashboard();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it('shows sessions when loaded', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/api/sessions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sessions: mockSessions }),
        });
      }
      if (url.includes('/api/repos')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ repos: mockRepos }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Test Issue 1')).toBeInTheDocument();
    });
  });

  it('shows empty state when no sessions', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/api/sessions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sessions: [] }),
        });
      }
      if (url.includes('/api/repos')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ repos: [] }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/No active sessions/i)).toBeInTheDocument();
    });
  });
});
