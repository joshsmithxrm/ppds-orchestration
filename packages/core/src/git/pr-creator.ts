import { spawn } from 'node:child_process';

/**
 * Options for creating a pull request.
 */
export interface CreatePROptions {
  /** Working directory (worktree path) */
  cwd: string;
  /** GitHub owner */
  githubOwner: string;
  /** GitHub repo name */
  githubRepo: string;
  /** PR title */
  title: string;
  /** PR body/description */
  body: string;
  /** Base branch to merge into (default: main) */
  baseBranch?: string;
  /** Whether to create as draft */
  draft?: boolean;
  /** Labels to add */
  labels?: string[];
}

/**
 * Result of creating a pull request.
 */
export interface CreatePRResult {
  success: boolean;
  /** URL of the created PR */
  url?: string;
  /** PR number */
  number?: number;
  error?: string;
}

/**
 * Creates a pull request using the GitHub CLI.
 *
 * @param options - PR creation options
 * @returns Result with PR URL and number on success
 */
export async function createPullRequest(options: CreatePROptions): Promise<CreatePRResult> {
  const {
    cwd,
    githubOwner,
    githubRepo,
    title,
    body,
    baseBranch,
    draft = false,
    labels = [],
  } = options;

  return new Promise((resolve) => {
    const args = [
      'pr', 'create',
      '--repo', `${githubOwner}/${githubRepo}`,
      '--title', title,
      '--body', body,
    ];

    if (baseBranch) {
      args.push('--base', baseBranch);
    }

    if (draft) {
      args.push('--draft');
    }

    for (const label of labels) {
      args.push('--label', label);
    }

    const proc = spawn('gh', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: `Failed to create PR: ${stderr || 'Unknown error'}`,
        });
        return;
      }

      // Parse PR URL from output
      const url = stdout.trim();
      const prNumberMatch = url.match(/\/pull\/(\d+)$/);
      const number = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

      resolve({
        success: true,
        url,
        number,
      });
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        error: `Failed to run gh CLI: ${error.message}`,
      });
    });
  });
}

/**
 * Generates a PR body from session information.
 */
export function generatePRBody(options: {
  issueNumber: number;
  issueTitle: string;
  summary?: string;
  testPlan?: string;
}): string {
  const { issueNumber, issueTitle, summary, testPlan } = options;

  let body = `## Summary\n\n`;
  body += summary || `Implementation for #${issueNumber}: ${issueTitle}`;
  body += `\n\n`;

  body += `## Related Issue\n\n`;
  body += `Closes #${issueNumber}\n\n`;

  if (testPlan) {
    body += `## Test Plan\n\n`;
    body += testPlan;
    body += `\n\n`;
  }

  body += `---\n`;
  body += `*Generated with [PPDS Orchestration](https://github.com/joshsmithxrm/ppds-orchestration)*\n`;

  return body;
}
