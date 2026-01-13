import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RalphStatus from './RalphStatus';

describe('RalphStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows "No active Ralph loop" when no state', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByText(/No active Ralph loop/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Start Ralph Loop/i })).toBeInTheDocument();
  });

  it('shows current state when loaded', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: {
            repoId: 'test-repo',
            sessionId: '123',
            config: { maxIterations: 10, iterationDelayMs: 5000 },
            currentIteration: 3,
            state: 'running',
            iterations: [],
            consecutiveFailures: 0,
          },
        }),
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    expect(screen.getByText(/Iteration 3 \/ 10/i)).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('shows continue button when waiting', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: {
            repoId: 'test-repo',
            sessionId: '123',
            config: { maxIterations: 10, iterationDelayMs: 5000 },
            currentIteration: 5,
            state: 'waiting',
            iterations: [],
            consecutiveFailures: 0,
          },
        }),
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByText('Waiting')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Continue to Next Iteration/i })).toBeInTheDocument();
  });

  it('shows stuck warning when stuck', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: {
            repoId: 'test-repo',
            sessionId: '123',
            config: { maxIterations: 10, iterationDelayMs: 5000 },
            currentIteration: 5,
            state: 'stuck',
            iterations: [],
            consecutiveFailures: 3,
          },
        }),
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByText('Stuck')).toBeInTheDocument();
    });

    expect(screen.getByText(/Loop is stuck/i)).toBeInTheDocument();
  });

  it('shows done message when complete', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: {
            repoId: 'test-repo',
            sessionId: '123',
            config: { maxIterations: 10, iterationDelayMs: 5000 },
            currentIteration: 10,
            state: 'done',
            iterations: [],
            consecutiveFailures: 0,
          },
        }),
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    expect(screen.getByText(/Ralph loop completed successfully/i)).toBeInTheDocument();
  });

  it('shows iteration history', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          state: {
            repoId: 'test-repo',
            sessionId: '123',
            config: { maxIterations: 10, iterationDelayMs: 5000 },
            currentIteration: 3,
            state: 'running',
            iterations: [
              { iteration: 1, startedAt: '2026-01-01T00:00:00Z', exitType: 'clean', doneSignalDetected: false },
              { iteration: 2, startedAt: '2026-01-01T00:01:00Z', exitType: 'clean', doneSignalDetected: false },
            ],
            consecutiveFailures: 0,
          },
        }),
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByText('Iteration History')).toBeInTheDocument();
    });

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('handles continue action', async () => {
    let fetchCallCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/continue')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      // Return different states based on call order
      fetchCallCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            state: {
              repoId: 'test-repo',
              sessionId: '123',
              config: { maxIterations: 10, iterationDelayMs: 5000 },
              currentIteration: 5,
              state: fetchCallCount === 1 ? 'waiting' : 'running',
              iterations: [],
              consecutiveFailures: 0,
            },
          }),
      });
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue to Next Iteration/i })).toBeInTheDocument();
    });

    const continueButton = screen.getByRole('button', { name: /Continue to Next Iteration/i });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/ralph/test-repo/123/continue',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('handles start action when no loop exists', async () => {
    let started = false;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/start')) {
        started = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (started) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              state: {
                repoId: 'test-repo',
                sessionId: '123',
                config: { maxIterations: 10, iterationDelayMs: 5000 },
                currentIteration: 1,
                state: 'running',
                iterations: [],
                consecutiveFailures: 0,
              },
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Ralph Loop/i })).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: /Start Ralph Loop/i });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/ralph/test-repo/123/start',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows no active loop message when fetch returns non-404 error (current behavior)', async () => {
    // Note: The component sets error state but renders "No active Ralph loop"
    // when state is null, which happens on non-404 errors. This test documents
    // the current behavior rather than ideal behavior.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    render(<RalphStatus repoId="test-repo" sessionId="123" />);

    // Due to current component logic, non-404 errors result in showing "No active Ralph loop"
    await waitFor(() => {
      expect(screen.getByText(/No active Ralph loop/i)).toBeInTheDocument();
    });
  });
});
