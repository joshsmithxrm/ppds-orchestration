import { spawn } from 'node:child_process';
import { parsePlanFile, type Task } from './plan-parser.js';

/**
 * Result of syncing checkboxes to GitHub.
 */
export interface CheckboxSyncResult {
  success: boolean;
  tasksUpdated: number;
  error?: string;
}

/**
 * Syncs task checkbox states from a plan file to a GitHub issue.
 *
 * This function:
 * 1. Parses the local plan file to get current task states
 * 2. Fetches the issue body from GitHub
 * 3. Updates checkbox states in the issue body to match local state
 * 4. Pushes the updated issue body back to GitHub
 *
 * @param planContent - Content of the IMPLEMENTATION_PLAN.md file
 * @param issueNumber - GitHub issue number to update
 * @param repoOwner - GitHub repository owner
 * @param repoName - GitHub repository name
 * @param cwd - Working directory for gh CLI
 */
export async function syncCheckboxesToIssue(
  planContent: string,
  issueNumber: number,
  repoOwner: string,
  repoName: string,
  cwd: string
): Promise<CheckboxSyncResult> {
  try {
    // Parse the plan file to get task states
    const plan = parsePlanFile(planContent);

    if (plan.tasks.length === 0) {
      return {
        success: true,
        tasksUpdated: 0,
      };
    }

    // Fetch current issue body from GitHub
    const issueBody = await fetchIssueBody(issueNumber, repoOwner, repoName, cwd);

    // Update checkboxes in issue body
    const { updatedBody, tasksUpdated } = updateCheckboxesInBody(issueBody, plan.tasks);

    if (tasksUpdated === 0) {
      return {
        success: true,
        tasksUpdated: 0,
      };
    }

    // Update the issue on GitHub
    await updateIssueBody(issueNumber, updatedBody, repoOwner, repoName, cwd);

    return {
      success: true,
      tasksUpdated,
    };
  } catch (error) {
    return {
      success: false,
      tasksUpdated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetches the issue body from GitHub using gh CLI.
 */
async function fetchIssueBody(
  issueNumber: number,
  repoOwner: string,
  repoName: string,
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', [
      'issue', 'view', issueNumber.toString(),
      '--repo', `${repoOwner}/${repoName}`,
      '--json', 'body',
      '--jq', '.body',
    ], { cwd });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to fetch issue #${issueNumber}: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to run gh CLI: ${error.message}`));
    });
  });
}

/**
 * Updates checkbox states in the issue body based on task states.
 *
 * Matches tasks by their description text (case-insensitive).
 * Returns the updated body and count of tasks updated.
 */
function updateCheckboxesInBody(
  body: string,
  tasks: Task[]
): { updatedBody: string; tasksUpdated: number } {
  let tasksUpdated = 0;

  // Create a map of task descriptions to their completion state
  const taskStates = new Map<string, boolean>();
  for (const task of tasks) {
    // Normalize description for matching
    const normalizedDesc = task.description.toLowerCase().trim();
    taskStates.set(normalizedDesc, task.complete);
  }

  // Regex to match GitHub checkboxes: - [ ] or - [x]
  const checkboxRegex = /^(\s*-\s*\[)([x\s])(\]\s*)(.+)$/gm;

  const updatedBody = body.replace(checkboxRegex, (match, prefix, checkbox, suffix, description) => {
    const normalizedDesc = description.toLowerCase().trim();

    // Check if we have a matching task
    const isComplete = taskStates.get(normalizedDesc);
    if (isComplete === undefined) {
      // No matching task, keep original
      return match;
    }

    const currentlyChecked = checkbox.toLowerCase() === 'x';
    if (currentlyChecked === isComplete) {
      // Already in correct state
      return match;
    }

    // Update the checkbox
    tasksUpdated++;
    const newCheckbox = isComplete ? 'x' : ' ';
    return `${prefix}${newCheckbox}${suffix}${description}`;
  });

  return { updatedBody, tasksUpdated };
}

/**
 * Updates the issue body on GitHub using gh CLI.
 */
async function updateIssueBody(
  issueNumber: number,
  body: string,
  repoOwner: string,
  repoName: string,
  cwd: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', [
      'issue', 'edit', issueNumber.toString(),
      '--repo', `${repoOwner}/${repoName}`,
      '--body', body,
    ], { cwd });

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to update issue #${issueNumber}: ${stderr}`));
        return;
      }
      resolve();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to run gh CLI: ${error.message}`));
    });
  });
}
