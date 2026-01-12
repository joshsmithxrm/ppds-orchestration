import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { WorktreeStatus } from '../session/types.js';

/**
 * Git utility functions for worktree and repository operations.
 */
export class GitUtils {
  private readonly repoRoot: string;
  private readonly git: SimpleGit;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.git = simpleGit(repoRoot);
  }

  /**
   * Finds the git repository root from a starting directory.
   */
  static findRepoRoot(startDir: string): string | null {
    let dir = startDir;

    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }

    return null;
  }

  /**
   * Gets the GitHub remote URL from the repository.
   */
  async getRemoteUrl(remoteName = 'origin'): Promise<string> {
    const remotes = await this.git.getRemotes(true);
    const remote = remotes.find(r => r.name === remoteName);

    if (!remote?.refs?.fetch) {
      throw new Error(`Remote '${remoteName}' not found or has no fetch URL`);
    }

    return remote.refs.fetch;
  }

  /**
   * Parses a GitHub URL to extract owner and repo name.
   * Supports both HTTPS and SSH formats.
   */
  static parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } {
    if (!remoteUrl) {
      throw new Error('Remote URL cannot be empty');
    }

    let url = remoteUrl.trim();

    // Remove trailing .git if present
    if (url.endsWith('.git')) {
      url = url.slice(0, -4);
    }

    let urlPath: string | null = null;

    // HTTPS format: https://github.com/owner/repo
    if (url.startsWith('https://github.com/')) {
      urlPath = url.slice('https://github.com/'.length);
    }
    // SSH format: git@github.com:owner/repo
    else if (url.startsWith('git@github.com:')) {
      urlPath = url.slice('git@github.com:'.length);
    }

    if (urlPath) {
      const parts = urlPath.split('/').filter(p => p.length > 0);
      if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
      }
    }

    throw new Error(`Cannot parse GitHub URL: ${remoteUrl}`);
  }

  /**
   * Creates a git worktree with a new branch from a base ref.
   * @param worktreePath - Path for the new worktree
   * @param branchName - Name of the new branch to create
   * @param baseBranch - Base ref to branch from (default: 'origin/main')
   */
  async createWorktree(
    worktreePath: string,
    branchName: string,
    baseBranch = 'origin/main'
  ): Promise<void> {
    // Remove existing worktree if present
    if (fs.existsSync(worktreePath)) {
      await this.removeWorktree(worktreePath);
    }

    // Fetch latest from origin to ensure we have the base branch
    try {
      await this.git.fetch('origin');
    } catch {
      // Ignore fetch errors (might be offline)
    }

    try {
      // Create worktree with new branch from base
      await this.git.raw(['worktree', 'add', worktreePath, '-b', branchName, baseBranch]);
    } catch (error) {
      // Branch might already exist, try without -b
      try {
        await this.git.raw(['worktree', 'add', worktreePath, branchName]);
      } catch (retryError) {
        throw new Error(`Failed to create worktree: ${retryError}`);
      }
    }
  }

  /**
   * Removes a git worktree.
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch {
      // Worktree might not exist, ignore error
    }
  }

  /**
   * Gets the git status for a worktree.
   */
  async getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
    const worktreeGit = simpleGit(worktreePath);

    // Get changed files
    const status = await worktreeGit.status();
    const changedFiles = [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map(r => r.to),
    ].slice(0, 10);

    // Get diff stats
    let insertions = 0;
    let deletions = 0;

    try {
      const diffSummary = await worktreeGit.diffSummary(['HEAD~1']);
      insertions = diffSummary.insertions;
      deletions = diffSummary.deletions;
    } catch {
      // Might not have commits yet, try unstaged diff
      try {
        const diffSummary = await worktreeGit.diffSummary();
        insertions = diffSummary.insertions;
        deletions = diffSummary.deletions;
      } catch {
        // Ignore
      }
    }

    // Get last commit message
    let lastCommitMessage: string | null = null;
    try {
      const log = await worktreeGit.log({ n: 1 });
      if (log.latest) {
        lastCommitMessage = log.latest.message;
      }
    } catch {
      // No commits yet
    }

    return {
      filesChanged: changedFiles.length + status.staged.length,
      insertions,
      deletions,
      lastCommitMessage,
      lastTestRun: null,
      testsPassing: null,
      changedFiles,
    };
  }

  /**
   * Checks if a directory is a valid git worktree.
   */
  static isWorktree(dirPath: string): boolean {
    // Worktrees have a .git file (not directory) pointing to the main repo
    const gitPath = path.join(dirPath, '.git');
    if (!fs.existsSync(gitPath)) {
      return false;
    }

    const stat = fs.statSync(gitPath);
    return stat.isFile(); // Worktrees have .git as a file
  }
}
