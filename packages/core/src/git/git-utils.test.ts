import { describe, it, expect } from 'vitest';
import { GitUtils } from './git-utils.js';

describe('GitUtils', () => {
  describe('parseGitHubUrl', () => {
    it('should parse HTTPS URL', () => {
      const result = GitUtils.parseGitHubUrl('https://github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse HTTPS URL without .git', () => {
      const result = GitUtils.parseGitHubUrl('https://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH URL', () => {
      const result = GitUtils.parseGitHubUrl('git@github.com:owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should parse SSH URL without .git', () => {
      const result = GitUtils.parseGitHubUrl('git@github.com:owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should handle URL with trailing whitespace', () => {
      const result = GitUtils.parseGitHubUrl('  https://github.com/owner/repo.git  ');
      expect(result).toEqual({ owner: 'owner', repo: 'repo' });
    });

    it('should throw for empty URL', () => {
      expect(() => GitUtils.parseGitHubUrl('')).toThrow('Remote URL cannot be empty');
    });

    it('should throw for invalid URL', () => {
      expect(() => GitUtils.parseGitHubUrl('not-a-github-url')).toThrow('Cannot parse GitHub URL');
    });

    it('should throw for non-GitHub URL', () => {
      expect(() => GitUtils.parseGitHubUrl('https://gitlab.com/owner/repo')).toThrow('Cannot parse GitHub URL');
    });
  });

  describe('findRepoRoot', () => {
    it('should find repo root from current directory', () => {
      // This test runs in the ppds-orchestration repo
      const root = GitUtils.findRepoRoot(process.cwd());
      expect(root).not.toBeNull();
      expect(root).toContain('ppds-orchestration');
    });

    it('should return null for non-repo directory', () => {
      const root = GitUtils.findRepoRoot('/tmp');
      expect(root).toBeNull();
    });
  });

  describe('isWorktree', () => {
    it('should return false for non-existent directory', () => {
      expect(GitUtils.isWorktree('/non/existent/path')).toBe(false);
    });

    it('should return false for regular git repo', () => {
      // Skip this test if we're running in a worktree (e.g., during issue branch work)
      const root = GitUtils.findRepoRoot(process.cwd());
      if (root && GitUtils.isWorktree(root)) {
        // We're in a worktree, can't test "regular git repo" behavior from here
        return;
      }
      if (root) {
        expect(GitUtils.isWorktree(root)).toBe(false);
      }
    });
  });
});
