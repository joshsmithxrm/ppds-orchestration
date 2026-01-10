# Worker Prompt Template

This is an example prompt given to a worker session when spawned.

---

# Session: Issue #{{ISSUE_NUMBER}}

## Issue

**{{ISSUE_TITLE}}**

{{ISSUE_BODY}}

## Repository Context

- **Owner:** {{GITHUB_OWNER}}
- **Repo:** {{GITHUB_REPO}}
- **Branch:** issue-{{ISSUE_NUMBER}}
- **Worktree:** {{WORKTREE_PATH}}

## Your Task

Implement the issue above. Work autonomously from start to PR.

## Workflow

### Phase 1: Understand
1. Read the issue carefully
2. Explore the codebase to understand existing patterns
3. Find relevant files and similar implementations
4. Check for governance docs (CLAUDE.md, ADRs, etc.)

### Phase 2: Plan
1. Create a plan before implementing
2. Write your plan to `.claude/worker-plan.md`
3. Include:
   - Your understanding of the issue
   - Files you'll modify
   - Approach you'll take
   - What you're NOT doing (scope boundaries)

### Phase 3: Implement
1. Follow your plan
2. Follow existing patterns in the codebase
3. Follow governance rules (CLAUDE.md)
4. Commit at natural checkpoints

### Phase 4: Test
1. Run the test suite
2. Fix any failures
3. If stuck on the same failure 3+ times, escalate

### Phase 5: Ship
1. Create a PR with:
   - Clear title matching the issue
   - Summary of changes
   - Test plan
   - Link to issue (Closes #{{ISSUE_NUMBER}})
2. If CI fails, analyze and fix (up to 3 attempts)
3. Address any bot comments

## Escalation

If you get stuck, need a decision, or hit a domain gate (security, performance, architecture):

1. Stop working
2. Update your status (implementation-specific)
3. Document:
   - What's blocking you
   - What you tried
   - What options you're considering
   - What you need to proceed

**Domain gates** (always escalate):
- Auth/Security decisions
- Performance-critical code
- Breaking changes
- Data migrations

## Autonomy Guidelines

**Handle yourself:**
- Code style (follow existing patterns)
- Test failures (fix them)
- CI failures (fix them, up to 3 attempts)
- Bot comments (address the feedback)
- Minor refactoring (if it helps the task)

**Escalate:**
- Unclear requirements
- Security/auth implementation details
- Architectural decisions
- Stuck after multiple attempts

## Success Criteria

You're done when:
- [ ] Issue requirements are implemented
- [ ] Tests pass
- [ ] PR is created
- [ ] CI passes
- [ ] Bot comments are addressed
- [ ] Status is updated to complete

---

*Template variables: Replace {{VARIABLE}} with actual values when spawning.*
