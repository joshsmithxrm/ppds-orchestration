import { simpleGit, SimpleGit } from 'simple-git';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { WorktreeStatus, WorktreeRemovalResult } from '../session/types.js';

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
   * Returns a result object indicating success or failure.
   */
  async removeWorktree(worktreePath: string): Promise<WorktreeRemovalResult> {
    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // These errors mean the worktree doesn't exist - that's not a failure
      if (
        msg.includes('is not a working tree') ||
        msg.includes('not a valid') ||
        msg.includes('is not a valid path')
      ) {
        return { success: true, notFound: true };
      }

      return { success: false, error: msg };
    }
  }

  /**
   * Gets the git status for a worktree.
   * @param worktreePath - Path to the worktree
   * @param baseBranch - Base branch to diff against (default: origin/main)
   */
  async getWorktreeStatus(worktreePath: string, baseBranch = 'origin/main'): Promise<WorktreeStatus> {
    const worktreeGit = simpleGit(worktreePath);

    // Get changed files (uncommitted)
    const status = await worktreeGit.status();
    const changedFiles = [
      ...status.modified,
      ...status.created,
      ...status.deleted,
      ...status.renamed.map(r => r.to),
    ].slice(0, 10);

    // Get diff stats: cumulative changes from baseBranch to HEAD (plus uncommitted)
    let insertions = 0;
    let deletions = 0;

    try {
      // Diff from base branch to HEAD (shows all committed changes on this branch)
      const diffSummary = await worktreeGit.diffSummary([`${baseBranch}...HEAD`]);
      insertions = diffSummary.insertions;
      deletions = diffSummary.deletions;

      // Also include uncommitted changes
      if (status.modified.length > 0 || status.created.length > 0 || status.deleted.length > 0) {
        try {
          const uncommittedDiff = await worktreeGit.diffSummary();
          insertions += uncommittedDiff.insertions;
          deletions += uncommittedDiff.deletions;
        } catch {
          // Ignore uncommitted diff errors
        }
      }
    } catch {
      // baseBranch might not exist or no common ancestor, fall back to unstaged diff
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

  /**
   * Lists all worktrees for this repository.
   */
  async listWorktrees(): Promise<Array<{ path: string; branch: string }>> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: Array<{ path: string; branch: string }> = [];

    let current: { path?: string; branch?: string } = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        // If we have a previous worktree, save it
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? '',
          });
        }
        current = { path: line.slice('worktree '.length).trim() };
      } else if (line.startsWith('branch ')) {
        // Extract branch name from refs/heads/xxx
        const ref = line.slice('branch '.length).trim();
        current.branch = ref.replace('refs/heads/', '');
      }
    }

    // Push the last worktree if present
    if (current.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? '',
      });
    }

    return worktrees;
  }

  /**
   * Gets the state of a worktree for deletion safety checks.
   * Returns counts of uncommitted files and unpushed commits.
   */
  async getWorktreeState(worktreePath: string): Promise<{
    uncommittedFiles: number;
    unpushedCommits: number;
    isClean: boolean;
  }> {
    const worktreeGit = simpleGit(worktreePath);

    // Count uncommitted files
    const status = await worktreeGit.status();
    const uncommittedFiles =
      status.modified.length +
      status.created.length +
      status.deleted.length +
      status.staged.length +
      status.not_added.length;

    // Count unpushed commits
    let unpushedCommits = 0;
    try {
      // Check if tracking branch exists
      const trackingBranch = await worktreeGit.raw(['rev-parse', '--abbrev-ref', '@{upstream}']);
      if (trackingBranch.trim()) {
        // Count commits ahead of upstream
        const output = await worktreeGit.raw(['rev-list', '--count', '@{upstream}..HEAD']);
        unpushedCommits = parseInt(output.trim(), 10) || 0;
      }
    } catch {
      // No upstream branch, all local commits are unpushed
      try {
        const output = await worktreeGit.raw(['rev-list', '--count', 'HEAD']);
        unpushedCommits = parseInt(output.trim(), 10) || 0;
      } catch {
        // No commits at all
        unpushedCommits = 0;
      }
    }

    return {
      uncommittedFiles,
      unpushedCommits,
      isClean: uncommittedFiles === 0 && unpushedCommits === 0,
    };
  }

  /**
   * Deletes a local branch.
   * @param branchName - Name of the branch to delete
   * @param force - Force delete even if not fully merged
   */
  async deleteLocalBranch(branchName: string, force = true): Promise<void> {
    const flag = force ? '-D' : '-d';
    await this.git.raw(['branch', flag, branchName]);
  }

  /**
   * Deletes a remote branch.
   * @param branchName - Name of the branch to delete
   * @param remote - Remote name (default: origin)
   */
  async deleteRemoteBranch(branchName: string, remote = 'origin'): Promise<void> {
    await this.git.raw(['push', remote, '--delete', branchName]);
  }
}
