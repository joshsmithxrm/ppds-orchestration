import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSounds } from './useSounds';

describe('useSounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (window.localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  });

  it('returns enabled=true by default', () => {
    const { result } = renderHook(() => useSounds(undefined));

    expect(result.current.enabled).toBe(true);
  });

  it('returns enabled=false when localStorage has "false"', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('false');

    const { result } = renderHook(() => useSounds(undefined));

    expect(result.current.enabled).toBe(false);
  });

  it('toggle updates state and localStorage', () => {
    const { result } = renderHook(() => useSounds(undefined));

    expect(result.current.enabled).toBe(true);

    act(() => {
      result.current.toggle();
    });

    expect(result.current.enabled).toBe(false);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      'orchestration-sounds-enabled',
      'false'
    );

    act(() => {
      result.current.toggle();
    });

    expect(result.current.enabled).toBe(true);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      'orchestration-sounds-enabled',
      'true'
    );
  });

  it('provides play functions', () => {
    const config = {
      onSpawn: '/sounds/spawn.mp3',
      onStuck: '/sounds/stuck.mp3',
      onComplete: '/sounds/complete.mp3',
    };

    const { result } = renderHook(() => useSounds(config));

    expect(typeof result.current.playOnSpawn).toBe('function');
    expect(typeof result.current.playOnStuck).toBe('function');
    expect(typeof result.current.playOnComplete).toBe('function');
  });

  it('play functions do nothing when disabled', () => {
    (window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('false');

    const config = {
      onSpawn: '/sounds/spawn.mp3',
    };

    const { result } = renderHook(() => useSounds(config));

    // Should not throw
    act(() => {
      result.current.playOnSpawn();
    });
  });
});
