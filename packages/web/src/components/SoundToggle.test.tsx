import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SoundToggle from './SoundToggle';

describe('SoundToggle', () => {
  it('renders enabled state correctly', () => {
    render(<SoundToggle enabled={true} onToggle={vi.fn()} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'Sounds enabled (click to mute)');
    expect(button).toHaveClass('text-green-400');
  });

  it('renders disabled state correctly', () => {
    render(<SoundToggle enabled={false} onToggle={vi.fn()} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'Sounds disabled (click to unmute)');
    expect(button).toHaveClass('text-gray-500');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<SoundToggle enabled={true} onToggle={onToggle} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
