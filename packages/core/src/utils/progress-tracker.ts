import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Progress entry representing a session's progress at a point in time.
 */
export interface ProgressEntry {
  /** ISO timestamp when progress was recorded */
  timestamp: string;
  /** Session ID */
  sessionId: string;
  /** Issue number */
  issueNumber: number;
  /** Current iteration (for ralph mode) */
  iteration?: number;
  /** Total tasks in plan */
  totalTasks: number;
  /** Completed tasks */
  completedTasks: number;
  /** Current status */
  status: string;
  /** Optional message/notes */
  message?: string;
}

/**
 * Progress file content structure.
 */
export interface ProgressFile {
  /** ISO timestamp when file was created */
  createdAt: string;
  /** ISO timestamp when file was last updated */
  updatedAt: string;
  /** All progress entries */
  entries: ProgressEntry[];
}

/**
 * Gets the path to the progress file for a session.
 */
export function getProgressFilePath(worktreePath: string): string {
  return path.join(worktreePath, '.claude', 'progress.json');
}

/**
 * Appends a progress entry to the session's progress file.
 *
 * Creates the file if it doesn't exist.
 *
 * @param worktreePath - Path to the worktree
 * @param entry - Progress entry to append (timestamp will be auto-set if not provided)
 */
export async function appendProgress(
  worktreePath: string,
  entry: Omit<ProgressEntry, 'timestamp'> & { timestamp?: string }
): Promise<void> {
  const filePath = getProgressFilePath(worktreePath);
  const claudeDir = path.dirname(filePath);

  // Ensure .claude directory exists
  if (!fs.existsSync(claudeDir)) {
    await fs.promises.mkdir(claudeDir, { recursive: true });
  }

  // Read existing progress or create new
  let progress: ProgressFile;
  const now = new Date().toISOString();

  if (fs.existsSync(filePath)) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    progress = JSON.parse(content);
    progress.updatedAt = now;
  } else {
    progress = {
      createdAt: now,
      updatedAt: now,
      entries: [],
    };
  }

  // Add entry with timestamp
  const fullEntry: ProgressEntry = {
    ...entry,
    timestamp: entry.timestamp ?? now,
  };
  progress.entries.push(fullEntry);

  // Write back
  await fs.promises.writeFile(filePath, JSON.stringify(progress, null, 2), 'utf-8');
}

/**
 * Reads all progress entries for a session.
 *
 * @param worktreePath - Path to the worktree
 * @returns Progress file content or null if file doesn't exist
 */
export async function readProgress(worktreePath: string): Promise<ProgressFile | null> {
  const filePath = getProgressFilePath(worktreePath);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Gets the latest progress entry for a session.
 *
 * @param worktreePath - Path to the worktree
 * @returns Latest progress entry or null if none exist
 */
export async function getLatestProgress(worktreePath: string): Promise<ProgressEntry | null> {
  const progress = await readProgress(worktreePath);
  if (!progress || progress.entries.length === 0) {
    return null;
  }
  return progress.entries[progress.entries.length - 1];
}

/**
 * Calculates completion percentage from a progress entry.
 */
export function calculateCompletionPercentage(entry: ProgressEntry): number {
  if (entry.totalTasks === 0) {
    return 0;
  }
  return Math.round((entry.completedTasks / entry.totalTasks) * 100);
}

/**
 * Formats a progress entry for display.
 */
export function formatProgressEntry(entry: ProgressEntry): string {
  const percentage = calculateCompletionPercentage(entry);
  const iterationPart = entry.iteration !== undefined ? ` (iteration ${entry.iteration})` : '';
  const messagePart = entry.message ? ` - ${entry.message}` : '';

  return `[${entry.timestamp}] #${entry.issueNumber}${iterationPart}: ${entry.completedTasks}/${entry.totalTasks} tasks (${percentage}%) - ${entry.status}${messagePart}`;
}
