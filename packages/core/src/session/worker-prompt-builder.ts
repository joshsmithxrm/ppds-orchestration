import { IssueRef, ExecutionMode } from './types.js';

/**
 * Context required to build a worker prompt.
 */
export interface PromptContext {
  /** GitHub owner (e.g., 'joshsmithxrm'). */
  githubOwner: string;

  /** GitHub repo name (e.g., 'power-platform-developer-suite'). */
  githubRepo: string;

  /** Issue to work on. */
  issue: IssueRef;

  /** Git branch name for this session. */
  branchName: string;

  /** Execution mode: 'manual' (user-controlled) or 'autonomous' (full loop). */
  mode?: ExecutionMode;

  /** Additional prompt sections to inject (from hooks). */
  additionalSections?: string[];
}

/**
 * Builds worker prompts for Claude Code sessions.
 *
 * Extracted from SessionService to follow Single Responsibility Principle.
 * This class handles all prompt template generation logic.
 *
 * Supports two execution modes:
 * - 'manual': User controls Claude interactively, no automation
 * - 'autonomous': Full loop worker that completes ONE task per session, then exits
 */
export class WorkerPromptBuilder {
  /**
   * Builds the worker prompt markdown.
   * Content varies based on execution mode.
   */
  build(context: PromptContext): string {
    const {
      issue,
      mode = 'manual',
      additionalSections,
    } = context;

    // Autonomous mode: minimal prompt - worker does ONE task then exits
    // Runs in headless mode (-p flag), writes status file to signal completion
    if (mode === 'autonomous') {
      let prompt = `# Session: Issue #${issue.number}

## Issue
**${issue.title}**

You are an autonomous worker. Read IMPLEMENTATION_PLAN.md in the worktree root for full context and tasks.

## Your Task
1. Read IMPLEMENTATION_PLAN.md
2. Find the first unchecked [ ] item - that is YOUR only task
3. Implement it and verify it works
4. Mark it [x] when done

## When Done
After completing your task, write your status to \`.claude/.worker-status\`:

- If there are MORE unchecked [ ] items remaining:
  \`\`\`bash
  mkdir -p .claude && echo "task_done" > .claude/.worker-status
  \`\`\`

- If ALL items are now checked [x] (you completed the last one):
  \`\`\`bash
  mkdir -p .claude && echo "complete" > .claude/.worker-status
  \`\`\`
`;

      if (additionalSections && additionalSections.length > 0) {
        prompt += '\n' + additionalSections.join('\n\n') + '\n';
      }

      return prompt;
    }

    // Single mode: full autonomous workflow
    return this.buildSingleModePrompt(context);
  }

  /**
   * Builds the full prompt for single/autonomous mode.
   * Single mode workers work autonomously until PR is ready.
   */
  private buildSingleModePrompt(context: PromptContext): string {
    const { githubOwner, githubRepo, issue, branchName, additionalSections } = context;

    let prompt = `# Session: Issue #${issue.number}

## Repository Context
- Owner: \`${githubOwner}\`
- Repo: \`${githubRepo}\`
- Issue: \`#${issue.number}\`
- Branch: \`${branchName}\`

## Issue
**${issue.title}**

${issue.body || '_No description provided._'}

## Workflow
1. Read and understand the issue
2. Explore the codebase
3. Implement the solution
4. Build and test
5. Create PR via \`/ship\`
`;

    if (additionalSections && additionalSections.length > 0) {
      prompt += '\n' + additionalSections.join('\n\n') + '\n';
    }

    return prompt;
  }
}
