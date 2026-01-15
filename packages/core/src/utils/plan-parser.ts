/**
 * Parser for IMPLEMENTATION_PLAN.md files
 *
 * Extracts task metadata from plan files copied from GitHub issue body.
 */

export interface Task {
  /** Task number extracted from "### Task N:" header */
  number: number;
  /** Task title from header line */
  title: string;
  /** Whether the task checkbox is checked */
  complete: boolean;
  /** Task description from **Description**: field */
  description: string;
  /** Phase number */
  phase: number;
  /** Task numbers this depends on, empty array if "None" */
  dependsOn: number[];
  /** Task numbers that can run in parallel */
  parallelWith: number[];
  /** Acceptance criteria */
  acceptance: string;
  /** Files to modify */
  files: string[];
  /** Test command */
  test: string;
}

export interface PlanSummary {
  total: number;
  complete: number;
  incomplete: number;
}

export interface ParsedPlan {
  tasks: Task[];
  summary: PlanSummary;
}

/**
 * Parse IMPLEMENTATION_PLAN.md content into structured task data.
 *
 * Task format:
 * ```
 * ### Task 0: Task Title
 * - [ ] **Description**: Task description here
 * - **Phase**: 0
 * - **Depends-On**: None
 * - **Parallel-With**: 1, 2, 3
 * - **Acceptance**: Acceptance criteria here
 * - **Files**: path/to/file.ts
 * - **Test**: `npm run test -- --grep "something"`
 * ```
 */
export function parsePlanFile(content: string): ParsedPlan {
  const tasks: Task[] = [];

  // Match task headers: ### Task N: Title
  const taskHeaderRegex = /^### Task (\d+):\s*(.*)$/gm;

  // Find all task sections
  const taskMatches: Array<{ number: number; title: string; startIndex: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = taskHeaderRegex.exec(content)) !== null) {
    taskMatches.push({
      number: parseInt(match[1], 10),
      title: match[2].trim(),
      startIndex: match.index,
    });
  }

  // Parse each task section
  for (let i = 0; i < taskMatches.length; i++) {
    const taskMatch = taskMatches[i];
    const nextTaskStart = i + 1 < taskMatches.length ? taskMatches[i + 1].startIndex : content.length;
    const taskContent = content.slice(taskMatch.startIndex, nextTaskStart);

    const task = parseTaskSection(taskMatch.number, taskMatch.title, taskContent);
    if (task) {
      tasks.push(task);
    }
  }

  const complete = tasks.filter((t) => t.complete).length;
  const summary: PlanSummary = {
    total: tasks.length,
    complete,
    incomplete: tasks.length - complete,
  };

  return { tasks, summary };
}

/**
 * Parse a single task section into a Task object.
 */
function parseTaskSection(number: number, title: string, content: string): Task | null {
  // Check for Description checkbox - only count properly formatted checkboxes
  // Pattern: "- [ ] **Description**:" or "- [x] **Description**:"
  const checkboxRegex = /^- \[([ x])\] \*\*Description\*\*:\s*(.*)$/m;
  const checkboxMatch = content.match(checkboxRegex);

  if (!checkboxMatch) {
    // No valid checkbox found in this task section
    return null;
  }

  const complete = checkboxMatch[1] === 'x';
  const description = checkboxMatch[2].trim();

  // Extract other fields
  const phase = extractNumberField(content, 'Phase') ?? 0;
  const dependsOn = extractNumberListField(content, 'Depends-On');
  const parallelWith = extractNumberListField(content, 'Parallel-With');
  const acceptance = extractTextField(content, 'Acceptance');
  const files = extractListField(content, 'Files');
  const test = extractTextField(content, 'Test');

  return {
    number,
    title,
    complete,
    description,
    phase,
    dependsOn,
    parallelWith,
    acceptance,
    files,
    test,
  };
}

/**
 * Extract a numeric field value.
 */
function extractNumberField(content: string, fieldName: string): number | null {
  const regex = new RegExp(`^- \\*\\*${fieldName}\\*\\*:\\s*(\\d+)`, 'm');
  const match = content.match(regex);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract a comma-separated list of numbers.
 * Returns empty array for "None" or missing field.
 */
function extractNumberListField(content: string, fieldName: string): number[] {
  const regex = new RegExp(`^- \\*\\*${fieldName}\\*\\*:\\s*(.*)$`, 'm');
  const match = content.match(regex);

  if (!match) return [];

  const value = match[1].trim();
  if (value.toLowerCase() === 'none' || value === '') return [];

  return value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/**
 * Extract a text field value.
 * Handles backtick-wrapped values like Test field.
 */
function extractTextField(content: string, fieldName: string): string {
  const regex = new RegExp(`^- \\*\\*${fieldName}\\*\\*:\\s*(.*)$`, 'm');
  const match = content.match(regex);

  if (!match) return '';

  let value = match[1].trim();

  // Remove surrounding backticks if present
  if (value.startsWith('`') && value.endsWith('`')) {
    value = value.slice(1, -1);
  }

  return value;
}

/**
 * Extract a comma-separated list of strings.
 */
function extractListField(content: string, fieldName: string): string[] {
  const regex = new RegExp(`^- \\*\\*${fieldName}\\*\\*:\\s*(.*)$`, 'm');
  const match = content.match(regex);

  if (!match) return [];

  const value = match[1].trim();
  if (value === '') return [];

  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Find the first incomplete task.
 *
 * @returns The first task where complete === false, or undefined if all done
 */
export function getCurrentTask(tasks: Task[]): Task | undefined {
  return tasks.find((task) => !task.complete);
}

/**
 * Check if all tasks in a plan are complete.
 *
 * @returns true when summary.incomplete === 0 && summary.total > 0
 */
export function isPromiseMet(content: string): boolean {
  const { summary } = parsePlanFile(content);
  return summary.incomplete === 0 && summary.total > 0;
}
