# Autonomous Worker

What happens inside each worker session from spawn to PR.

## Worker Lifecycle

```
Spawn
  ↓
Read issue context
  ↓
Explore codebase
  ↓
Create implementation plan
  ↓
Implement
  ↓
Run tests (fix if failing)
  ↓
Create PR
  ↓
Handle CI failures (fix and retry)
  ↓
Handle bot comments (address feedback)
  ↓
Mark complete
```

## Phase 1: Understanding

Worker receives:
- Issue number
- Issue title and body
- Repository context

Worker does:
1. Read the issue carefully
2. Explore the codebase to understand patterns
3. Identify relevant files and existing implementations
4. Note any governance rules (CLAUDE.md, ADRs, etc.)

## Phase 2: Planning

Before implementing, worker creates a plan:

```markdown
## My Understanding
[Restate the issue - proves alignment]

## Approach
[Implementation steps]

## Files to Modify
[List of files and what changes]

## What I'm NOT Doing
[Explicit scope boundaries]

## Questions
[Any clarifications needed before proceeding]
```

**Why plan first?**
- Catches misunderstandings before code is written
- Creates alignment checkpoint (optional human review)
- Documents reasoning for PR reviewers

## Phase 3: Implementation

Worker implements the plan:
- Follow existing patterns in the codebase
- Follow governance rules (CLAUDE.md)
- Make incremental commits at natural checkpoints
- Don't over-engineer - implement what's needed

### Commit Checkpoints

| Phase | When to Commit |
|-------|----------------|
| Planning | After plan is written |
| Implementation | After core implementation |
| Tests | After tests pass |

Commits create recovery points if the session crashes.

## Phase 4: Testing

Worker runs tests:
1. Run relevant test suite
2. If tests fail:
   - Analyze failure
   - Fix the issue
   - Run again
3. Repeat until passing (max 5 attempts)
4. If still failing after 5 attempts → escalate (stuck)

## Phase 5: Shipping

Worker creates PR:
1. Commit any remaining changes
2. Push branch to remote
3. Create PR with:
   - Clear title (matches issue)
   - Summary of changes
   - Test plan
   - Link to issue

### Handling CI

If CI fails:
1. Fetch CI logs
2. Analyze failure (test failure? lint? build?)
3. Fix the issue
4. Push fix
5. Wait for CI again
6. Repeat up to 3 times
7. If still failing → escalate

### Handling Bot Comments

If bots leave comments (linters, security scanners, etc.):
1. Read the comments
2. Address valid feedback
3. Push fixes
4. Continue

## Phase 6: Complete

Worker marks status as complete:
- Updates status file with PR URL
- Worker's job is done

Human reviews and merges the PR.

## Escalation Points

Workers escalate (set status to "stuck") when:

| Situation | Why Escalate |
|-----------|--------------|
| Unclear requirements | Don't guess what user wants |
| Security/auth decisions | Too sensitive to guess |
| Architecture questions | Might have project-wide impact |
| Test failure loop | After 3 attempts, need help |
| CI failure loop | After 3 attempts, need help |
| Merge conflict | May need human decision |

When escalating, include:
- What's blocking
- What was tried
- What options were considered
- What's needed to proceed

## What Workers Handle Autonomously

| Task | Autonomous? |
|------|-------------|
| Reading and understanding issue | Yes |
| Exploring codebase | Yes |
| Creating implementation plan | Yes |
| Writing code | Yes |
| Running tests | Yes |
| Fixing test failures | Yes (up to 5 attempts) |
| Creating PR | Yes |
| Fixing CI failures | Yes (up to 3 attempts) |
| Addressing bot comments | Yes |
| Security/auth decisions | No - escalate |
| Unclear requirements | No - escalate |
| Architectural decisions | No - escalate |

## Worker Prompt Structure

Workers should receive a prompt that includes:

```markdown
# Session: Issue #123

## Issue
**[Title]**

[Body]

## Repository Context
- Owner: [owner]
- Repo: [repo]
- Branch: issue-123

## Workflow
1. Explore codebase and understand patterns
2. Create implementation plan
3. Implement
4. Test
5. Create PR

## Governance
[Reference to CLAUDE.md or equivalent]

## Escalation
If stuck, [how to update status / signal escalation]
```

See [Worker Prompt Template](../templates/worker-prompt.md) for a complete example.
