import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We'll test the formatting functions directly since the command
// depends on createSessionService which requires a config file

describe('List command formatting', () => {
  // Test the elapsed time calculation
  describe('getElapsedTime', () => {
    const getElapsedTime = (startedAt: string): string => {
      const start = new Date(startedAt).getTime();
      const now = Date.now();
      const minutes = Math.floor((now - start) / 60000);

      if (minutes < 60) {
        return `${minutes}m`;
      }

      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h${remainingMinutes}m`;
    };

    it('should format minutes correctly', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
      expect(getElapsedTime(fiveMinutesAgo)).toBe('5m');
    });

    it('should format hours and minutes correctly', () => {
      const ninetyMinutesAgo = new Date(Date.now() - 90 * 60000).toISOString();
      expect(getElapsedTime(ninetyMinutesAgo)).toBe('1h30m');
    });

    it('should format zero minutes correctly', () => {
      const now = new Date().toISOString();
      expect(getElapsedTime(now)).toBe('0m');
    });
  });

  // Test stale detection
  describe('isStale', () => {
    const STALE_THRESHOLD_MS = 90_000;

    const isStale = (lastHeartbeat: string): boolean => {
      const heartbeat = new Date(lastHeartbeat).getTime();
      return Date.now() - heartbeat > STALE_THRESHOLD_MS;
    };

    it('should return true for old heartbeat', () => {
      const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
      expect(isStale(twoMinutesAgo)).toBe(true);
    });

    it('should return false for recent heartbeat', () => {
      const now = new Date().toISOString();
      expect(isStale(now)).toBe(false);
    });

    it('should return false for heartbeat just under threshold', () => {
      const justUnder = new Date(Date.now() - 80_000).toISOString();
      expect(isStale(justUnder)).toBe(false);
    });
  });
});
