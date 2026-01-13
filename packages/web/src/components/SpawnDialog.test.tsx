import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpawnDialog, { parseIssueNumbers } from './SpawnDialog';

describe('parseIssueNumbers', () => {
  it('parses single issue number', () => {
    const result = parseIssueNumbers('42');
    expect(result).toEqual({ numbers: [42] });
  });

  it('parses comma-separated issue numbers', () => {
    const result = parseIssueNumbers('1, 2, 3');
    expect(result).toEqual({ numbers: [1, 2, 3] });
  });

  it('parses space-separated issue numbers', () => {
    const result = parseIssueNumbers('1 2 3');
    expect(result).toEqual({ numbers: [1, 2, 3] });
  });

  it('parses mixed comma and space separated issue numbers', () => {
    const result = parseIssueNumbers('1, 2 3');
    expect(result).toEqual({ numbers: [1, 2, 3] });
  });

  it('handles extra whitespace', () => {
    const result = parseIssueNumbers('  1,  2,   3  ');
    expect(result).toEqual({ numbers: [1, 2, 3] });
  });

  it('returns error for empty input', () => {
    const result = parseIssueNumbers('');
    expect(result).toEqual({ error: 'Please enter at least one issue number' });
  });

  it('returns error for whitespace-only input', () => {
    const result = parseIssueNumbers('   ');
    expect(result).toEqual({ error: 'Please enter at least one issue number' });
  });

  it('returns error for invalid input', () => {
    const result = parseIssueNumbers('1, abc, 3');
    expect(result).toEqual({ error: 'Invalid issue number(s): abc' });
  });

  it('returns error for multiple invalid inputs', () => {
    const result = parseIssueNumbers('foo, bar');
    expect(result).toEqual({ error: 'Invalid issue number(s): foo, bar' });
  });

  it('returns error for zero', () => {
    const result = parseIssueNumbers('0');
    expect(result).toEqual({ error: 'Invalid issue number(s): 0' });
  });

  it('returns error for negative numbers', () => {
    const result = parseIssueNumbers('-1');
    expect(result).toEqual({ error: 'Invalid issue number(s): -1' });
  });
});

describe('SpawnDialog', () => {
  const mockOnClose = vi.fn();
  const mockOnSpawn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful repos fetch
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          repos: [
            { id: 'repo-1', config: { path: '/path/to/repo-1', defaultMode: 'single' } },
            { id: 'repo-2', config: { path: '/path/to/repo-2', defaultMode: 'ralph' } },
          ],
        }),
    });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SpawnDialog isOpen={false} onClose={mockOnClose} onSpawn={mockOnSpawn} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders dialog when isOpen is true', async () => {
    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    // Use getAllByText since there are two elements with "Spawn Worker" (heading and button)
    expect(screen.getAllByText('Spawn Worker')).toHaveLength(2);
    expect(screen.getByText(/Repository/i)).toBeInTheDocument();
    expect(screen.getByText('Issue Number(s)')).toBeInTheDocument();
  });

  it('shows validation error for empty issue number', async () => {
    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: /Spawn Worker/i });
    fireEvent.click(submitButton);

    expect(screen.getByText(/Please enter at least one issue number/i)).toBeInTheDocument();
    expect(mockOnSpawn).not.toHaveBeenCalled();
  });

  it('shows validation error for invalid issue number', async () => {
    const { container } = render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const issueInput = screen.getByPlaceholderText('e.g., 5 or 1, 2, 3');
    // Use fireEvent.change with value "0" which is invalid (must be > 0)
    fireEvent.change(issueInput, { target: { value: '0' } });

    // Submit the form directly using querySelector
    const form = container.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText(/Invalid issue number/i)).toBeInTheDocument();
    });
    expect(mockOnSpawn).not.toHaveBeenCalled();
  });

  it('calls onSpawn with single issue as array on submit', async () => {
    const user = userEvent.setup();
    mockOnSpawn.mockResolvedValue(undefined);

    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const issueInput = screen.getByPlaceholderText('e.g., 5 or 1, 2, 3');
    await user.type(issueInput, '42');

    const submitButton = screen.getByRole('button', { name: /Spawn Worker/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSpawn).toHaveBeenCalledWith('repo-1', [42], 'single', undefined);
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onSpawn with multiple comma-separated issues as array', async () => {
    const user = userEvent.setup();
    mockOnSpawn.mockResolvedValue(undefined);

    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const issueInput = screen.getByPlaceholderText('e.g., 5 or 1, 2, 3');
    await user.type(issueInput, '1, 2, 3');

    const submitButton = screen.getByRole('button', { name: /Spawn Worker/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSpawn).toHaveBeenCalledWith('repo-1', [1, 2, 3], 'single', undefined);
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onSpawn with multiple space-separated issues as array', async () => {
    const user = userEvent.setup();
    mockOnSpawn.mockResolvedValue(undefined);

    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const issueInput = screen.getByPlaceholderText('e.g., 5 or 1, 2, 3');
    await user.type(issueInput, '4 5 6');

    const submitButton = screen.getByRole('button', { name: /Spawn Worker/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSpawn).toHaveBeenCalledWith('repo-1', [4, 5, 6], 'single', undefined);
    });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows validation error for mixed valid and invalid input', async () => {
    const user = userEvent.setup();
    mockOnSpawn.mockResolvedValue(undefined);

    const { container } = render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const issueInput = screen.getByPlaceholderText('e.g., 5 or 1, 2, 3');
    await user.type(issueInput, '1, abc, 3');

    const form = container.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText(/Invalid issue number\(s\): abc/i)).toBeInTheDocument();
    });
    expect(mockOnSpawn).not.toHaveBeenCalled();
  });

  it('has execution mode toggle buttons', async () => {
    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    // Verify both mode buttons exist
    expect(screen.getByText('Single')).toBeInTheDocument();
    expect(screen.getByText('Ralph')).toBeInTheDocument();

    // Verify mode description is shown
    expect(screen.getByText(/Worker runs autonomously/i)).toBeInTheDocument();
  });

  it('closes dialog when Cancel button is clicked', async () => {
    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows error when onSpawn fails', async () => {
    const user = userEvent.setup();
    mockOnSpawn.mockRejectedValue(new Error('Spawn failed'));

    render(<SpawnDialog isOpen={true} onClose={mockOnClose} onSpawn={mockOnSpawn} />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const issueInput = screen.getByPlaceholderText('e.g., 5 or 1, 2, 3');
    await user.type(issueInput, '42');

    const submitButton = screen.getByRole('button', { name: /Spawn Worker/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Spawn failed/i)).toBeInTheDocument();
    });
    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
