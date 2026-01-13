import { useEffect, useRef, useState, useCallback } from 'react';

interface SoundsConfig {
  onSpawn?: string;
  onStuck?: string;
  onComplete?: string;
}

export interface UseSoundsReturn {
  enabled: boolean;
  toggle: () => void;
  playOnSpawn: () => void;
  playOnStuck: () => void;
  playOnComplete: () => void;
}

const STORAGE_KEY = 'orchestration-sounds-enabled';

export function useSounds(config: SoundsConfig | undefined): UseSoundsReturn {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== 'false'; // Default to enabled
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioCache = useRef<Map<string, AudioBuffer>>(new Map());
  const userInteracted = useRef(false);

  // Initialize AudioContext on first user interaction
  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    userInteracted.current = true;
    return audioContextRef.current;
  }, []);

  // Track user interaction
  useEffect(() => {
    const handleInteraction = () => {
      userInteracted.current = true;
      // Initialize audio context on first interaction
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
    };

    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // Preload sounds
  useEffect(() => {
    if (!config || !enabled) return;

    const loadSound = async (url: string) => {
      if (audioCache.current.has(url)) return;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`Failed to load sound: ${url}`);
          return;
        }
        const arrayBuffer = await response.arrayBuffer();

        // Need audio context to decode
        const ctx = audioContextRef.current || new AudioContext();
        audioContextRef.current = ctx;

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioCache.current.set(url, audioBuffer);
      } catch (error) {
        console.warn(`Failed to load sound: ${url}`, error);
      }
    };

    if (config.onSpawn) loadSound(config.onSpawn);
    if (config.onStuck) loadSound(config.onStuck);
    if (config.onComplete) loadSound(config.onComplete);
  }, [config, enabled]);

  const playSound = useCallback(
    async (soundUrl: string | undefined) => {
      if (!soundUrl || !enabled) return;

      // Skip if no user interaction yet (browser autoplay policy)
      if (!userInteracted.current) {
        console.log('Sound skipped - waiting for user interaction');
        return;
      }

      try {
        const ctx = initAudio();

        // Handle browser autoplay restrictions
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        let buffer = audioCache.current.get(soundUrl);
        if (!buffer) {
          // Load on demand if not cached
          const response = await fetch(soundUrl);
          if (!response.ok) {
            console.warn(`Failed to fetch sound: ${soundUrl}`);
            return;
          }
          const arrayBuffer = await response.arrayBuffer();
          buffer = await ctx.decodeAudioData(arrayBuffer);
          audioCache.current.set(soundUrl, buffer);
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch (error) {
        console.warn('Failed to play sound:', error);
      }
    },
    [enabled, initAudio]
  );

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY, String(newValue));

      // Initialize AudioContext on enable (user interaction)
      if (newValue) {
        initAudio();
      }

      return newValue;
    });
  }, [initAudio]);

  return {
    enabled,
    toggle,
    playOnSpawn: useCallback(
      () => playSound(config?.onSpawn),
      [playSound, config?.onSpawn]
    ),
    playOnStuck: useCallback(
      () => playSound(config?.onStuck),
      [playSound, config?.onStuck]
    ),
    playOnComplete: useCallback(
      () => playSound(config?.onComplete),
      [playSound, config?.onComplete]
    ),
  };
}
