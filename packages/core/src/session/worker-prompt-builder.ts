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
 * Supports three execution modes:
 * - 'manual': User controls Claude interactively, no automation
 * - 'autonomous': Build worker that completes ONE task per session, then exits
 * - 'planning': Planning worker that explores codebase and creates IMPLEMENTATION_PLAN.md
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

    // Planning mode: worker explores codebase and creates IMPLEMENTATION_PLAN.md
    // Uses Claude's built-in plan mode via system instructions
    if (mode === 'planning') {
      return this.buildPlanningModePrompt(context);
    }

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

  /**
   * Builds the prompt for planning mode.
   * Planning workers explore the codebase and create IMPLEMENTATION_PLAN.md.
   * Uses Claude's built-in plan mode via system instructions.
   * NOTE: Can revisit this approach if plan mode doesn't work well.
   */
  private buildPlanningModePrompt(context: PromptContext): string {
    const { issue, branchName, additionalSections } = context;

    let prompt = `<system-reminder>
Plan mode is active. You MUST NOT make any code edits or run non-readonly tools.
You are only allowed to take READ-ONLY actions and write to the plan file.

Plan File: IMPLEMENTATION_PLAN.md
</system-reminder>

# Planning Worker - Issue #${issue.number}

You are a planning worker designing the implementation for issue #${issue.number}.

## Your Task

Read SPEC.md and create a detailed implementation plan.

## Specification Location

Read the requirements from: \`SPEC.md\`

## Session Context

- **Issue:** #${issue.number}
- **Branch:** ${branchName}

## Workflow: The Planning Pattern

### Phase 1: Understand (20-30% of work)

1. Read SPEC.md thoroughly
2. Identify the core requirements
3. Note any constraints or acceptance criteria

### Phase 2: Explore (30-40% of work)

1. Search the codebase for relevant patterns
2. Read key files that will be modified
3. Understand existing architecture
4. Identify dependencies and integration points

### Phase 3: Design (20-30% of work)

1. Break the work into atomic tasks
2. Identify task dependencies
3. Define acceptance criteria for each task
4. Specify test commands for verification

### Phase 4: Document (10-15% of work)

1. Write IMPLEMENTATION_PLAN.md with structured tasks
2. Ensure each task is independently completable
3. Signal planning complete

## Plan Format

Create \`IMPLEMENTATION_PLAN.md\` with this structure:

\`\`\`markdown
# Implementation Plan: ${issue.title}

## Summary
Brief description of what this plan implements.

## Tasks

### Task 0: [Task Title]
- [ ] **Description**: Clear description of what to implement
- **Phase**: 0 (or higher for dependent tasks)
- **Depends-On**: None (or list of task numbers: 1, 2)
- **Acceptance**: How to verify this is done correctly
- **Files**: List of files to create/modify
- **Test**: \`specific test command to run\`

### Task 1: [Task Title]
- [ ] **Description**: ...
- **Phase**: 1
- **Depends-On**: 0
- **Acceptance**: ...
- **Files**: ...
- **Test**: \`...\`

(continue for all tasks)
\`\`\`

## When Done

1. Write IMPLEMENTATION_PLAN.md to the worktree root
2. Call ExitPlanMode to signal you're done planning
3. Write status signal:
   \`\`\`bash
   mkdir -p .claude && echo "planning_complete" > .claude/.worker-status
   \`\`\`

## What You Do NOT Do

- **Write code** - planning only, no implementation
- **Commit** - orchestrator handles this
- **Push** - orchestrator handles this
- **Work on multiple issues** - one plan per session
- **Skip exploration** - understand before planning
`;

    if (additionalSections && additionalSections.length > 0) {
      prompt += '\n' + additionalSections.join('\n\n') + '\n';
    }

    prompt += `
---

Begin by reading SPEC.md.
`;

    return prompt;
  }
}
