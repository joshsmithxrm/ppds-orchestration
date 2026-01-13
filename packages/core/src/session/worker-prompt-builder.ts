import { IssueRef, ExecutionMode } from './types.js';

/**
 * Context required to build a worker prompt.
 */
export interface PromptContext {
  /** GitHub owner (e.g., 'joshsmithxrm'). */
  githubOwner: string;

  /** GitHub repo name (e.g., 'power-platform-developer-suite'). */
  githubRepo: string;

  /** Issues to work on. First issue is the primary. */
  issues: IssueRef[];

  /** Git branch name for this session. */
  branchName: string;

  /** Execution mode: 'single' (autonomous) or 'ralph' (iterative). */
  mode?: ExecutionMode;

  /** Additional prompt sections to inject (from hooks). */
  additionalSections?: string[];
}

/**
 * Builds worker prompts for Claude Code sessions.
 *
 * Extracted from SessionService to follow Single Responsibility Principle.
 * This class handles all prompt template generation logic.
 */
export class WorkerPromptBuilder {
  /**
   * Builds the worker prompt markdown.
   */
  build(context: PromptContext): string {
    const {
      githubOwner,
      githubRepo,
      issues,
      branchName,
      additionalSections,
    } = context;

    const primaryIssue = issues[0];
    const issueNumbers = issues.map(i => i.number);
    const isMultiIssue = issues.length > 1;

    // Build the header based on single vs multi-issue
    let prompt: string;
    if (isMultiIssue) {
      prompt = this.buildMultiIssueHeader(
        issues,
        issueNumbers,
        branchName,
        githubOwner,
        githubRepo
      );
    } else {
      prompt = this.buildSingleIssueHeader(
        primaryIssue,
        branchName,
        githubOwner,
        githubRepo
      );
    }

    // Add common sections
    prompt += this.buildCommonSections();

    // Add additional prompt sections from hooks
    if (additionalSections && additionalSections.length > 0) {
      prompt += '\n## Additional Instructions\n\n';
      prompt += additionalSections.join('\n\n');
      prompt += '\n';
    }

    return prompt;
  }

  /**
   * Builds the header section for a single-issue session.
   */
  private buildSingleIssueHeader(
    issue: IssueRef,
    branchName: string,
    githubOwner: string,
    githubRepo: string
  ): string {
    return `# Session: Issue #${issue.number}

## Repository Context

**IMPORTANT:** For all GitHub operations (CLI and MCP tools), use these values:
- Owner: \`${githubOwner}\`
- Repo: \`${githubRepo}\`
- Issue: \`#${issue.number}\`
- Branch: \`${branchName}\`

Examples:
\`\`\`bash
gh issue view ${issue.number} --repo ${githubOwner}/${githubRepo}
gh pr create --repo ${githubOwner}/${githubRepo} ...
\`\`\`

## Issue
**${issue.title}**

${issue.body || '_No description provided._'}
`;
  }

  /**
   * Builds the header section for a multi-issue session.
   */
  private buildMultiIssueHeader(
    issues: IssueRef[],
    issueNumbers: number[],
    branchName: string,
    githubOwner: string,
    githubRepo: string
  ): string {
    const primaryIssue = issues[0];

    return `# Session: Issues ${issueNumbers.map(n => `#${n}`).join(', ')}

## Repository Context

**IMPORTANT:** For all GitHub operations (CLI and MCP tools), use these values:
- Owner: \`${githubOwner}\`
- Repo: \`${githubRepo}\`
- Issues: ${issueNumbers.map(n => `\`#${n}\``).join(', ')}
- Branch: \`${branchName}\`

Examples:
\`\`\`bash
gh issue view ${primaryIssue.number} --repo ${githubOwner}/${githubRepo}
gh pr create --repo ${githubOwner}/${githubRepo} ...
\`\`\`

## Issues

${issues.map(issue => `### Issue #${issue.number}: ${issue.title}

${issue.body || '_No description provided._'}
`).join('\n')}

## Combined Implementation

You are implementing **${issues.length} related issues** in a single PR.

**Approach:**
1. Plan how these issues relate to each other
2. Identify shared components or dependencies
3. Implement in a logical order
4. Create ONE PR that addresses all issues

**PR Requirements:**
- Title should reference the primary issue or summarize all
- Body should have sections for each issue addressed
- Use \`Closes ${issueNumbers.map(n => `#${n}`).join(', Closes ')}\` to auto-close all issues
`;
  }

  /**
   * Builds the common sections that appear in all prompts.
   */
  private buildCommonSections(): string {
    return `
## Guidance

If \`forwardedMessage\` exists in the session file, incorporate that guidance
into your approach before continuing.

## Status Reporting

**Report status at each phase transition** by updating the session file directly.

**Session file location:** Read \`session-context.json\` in the worktree root to find the \`sessionFilePath\` field.

| Phase | Status Value |
|-------|--------------|
| Starting | \`planning\` |
| Plan complete | \`planning_complete\` |
| Implementing | \`working\` |
| Stuck | \`stuck\` (also set \`stuckReason\`) |
| Complete | \`complete\` |

**How to update status:**
1. Read the session file (path from \`session-context.json\` → \`sessionFilePath\`)
2. Update the \`status\` field to the new value
3. Update \`lastHeartbeat\` to current ISO timestamp
4. If stuck, also set \`stuckReason\` to explain what you need
5. Write the updated JSON back to the session file

**Note:** \`/ship\` automatically updates status to \`shipping\` → \`reviews_in_progress\` → \`complete\`.

## Workflow

### Phase 1: Planning
1. **First:** Update session file with \`"status": "planning"\`
2. Read and understand the issue requirements
3. Explore the codebase to understand existing patterns
4. Create a detailed implementation plan
5. Write your plan to \`.claude/worker-plan.md\`
6. **Then:** Update session file with \`"status": "planning_complete"\`

### Message Check Protocol

Check for forwarded messages at these points:
1. **After each phase** - planning complete, before implementation, after tests
2. **When stuck** - check every 5 minutes while waiting for guidance
3. **Before major decisions** - architectural choices, security implementations

**How to check:** Read the session file and check the \`forwardedMessage\` field.

**If message exists:**
1. Read and incorporate the guidance into your approach
2. Clear the message by setting \`forwardedMessage\` to \`undefined\` (or remove the field)
3. Continue with your work (the guidance may unstick you)

**Important:** When your status is \`stuck\`, check for messages periodically - the orchestrator may have sent guidance that unblocks you.

### Phase 3: Implementation
1. **First:** Update session file with \`"status": "working"\`
2. Follow your plan in \`.claude/worker-plan.md\`
3. Build and test your changes
4. Create PR via \`/ship\` (handles remaining status updates automatically)

### Domain Gates
If you encounter these, set status to \`stuck\` with a clear reason:
- Auth/Security decisions
- Performance-critical code
- Breaking changes
- Data migration

**Example:** Update session file with \`"status": "stuck"\` and \`"stuckReason": "Need auth decision: should we use JWT or session tokens?"\`

## Reference
- Follow CLAUDE.md for coding standards
- Build must pass before shipping
- Tests must pass before shipping
`;
  }
}
