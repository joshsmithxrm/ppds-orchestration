# Parallel Orchestration

How to coordinate multiple Claude workers on a shared codebase.

## The Flow

```
You (design) → Orchestrator (spawn) → Workers (implement) → PRs (review) → You
```

### Phase 1: Planning

Before spawning workers, discuss with the orchestrator:

1. **What issues are ready to work?**
   - Which have clear requirements?
   - Which are independent (can parallelize)?
   - Which have dependencies (must sequence)?

2. **How many workers?**
   - More workers = faster throughput
   - But: merge conflicts if touching same files
   - Recommended: 3-5 max for manageable review load

3. **Any special considerations?**
   - Issues that need design discussion first
   - Issues that touch sensitive areas (security, performance)
   - Issues that might conflict

### Phase 2: Spawning

For each issue, the orchestrator:

1. **Creates a git worktree**
   ```
   git worktree add ../project-issue-123 -b issue-123
   ```

2. **Writes a session prompt** with:
   - Issue number, title, body
   - Repository context (owner, repo)
   - Workflow instructions

3. **Starts a Claude session** in the worktree

4. **Registers the session** (creates status file)

### Phase 3: Monitoring

While workers run, the orchestrator can report status:

```
Active Sessions (3):

[*] #123 - WORKING (45m) - Add export button
    Files changed: 3 (+42, -5)

[!] #124 - STUCK (12m) - Implement auth flow
    Reason: Auth decision needed - token refresh approach unclear

[+] #125 - PR READY - Add dark mode
    PR: https://github.com/owner/repo/pull/42
```

**Key insight**: You shouldn't need to monitor. The system should tell you when something needs your attention (stuck, PR ready).

### Phase 4: Handling Stuck Workers

When a worker gets stuck:

1. Orchestrator presents the context:
   ```
   Worker #124 is stuck on auth flow:

   Decision needed: Token refresh approach
   Options considered: sliding expiration, fixed expiration
   Context: User tokens expire after 1 hour, need seamless refresh
   ```

2. You provide guidance:
   ```
   "Use sliding expiration with 15-minute window"
   ```

3. Orchestrator forwards to worker (writes to status file or worktree)

4. Worker reads guidance and continues

### Phase 5: PR Review

When workers complete:

1. Worker creates PR, handles CI and bot comments
2. Worker updates status to "complete" with PR URL
3. Orchestrator reports PR ready
4. You review the PR normally
5. You merge (workers never merge)

## Coordination Strategies

### Independent Issues

Issues that don't touch the same files can run fully in parallel.

```
#123: Add export button     → src/components/ExportButton.tsx
#124: Fix login bug         → src/auth/login.ts
#125: Update documentation  → docs/

No conflicts - full parallel
```

### Related Issues

Issues that might touch the same files need sequencing:

```
#126: Refactor auth service → src/auth/service.ts
#127: Add SSO support       → src/auth/service.ts (depends on 126)

Sequence: Do 126 first, then 127 on top of 126's branch
```

### Merge Conflicts

If conflicts occur:

1. Worker detects conflict when pushing or rebasing
2. Worker updates status to "stuck" with conflict details
3. You decide: resolve manually, or have worker attempt resolution
4. After resolution, worker continues

## Status File Schema

```json
{
  "id": "123",
  "issueNumber": 123,
  "issueTitle": "Add export button",
  "status": "working",
  "branch": "issue-123",
  "worktreePath": "/path/to/project-issue-123",
  "startedAt": "2025-01-08T10:30:00Z",
  "lastHeartbeat": "2025-01-08T11:15:00Z",
  "stuckReason": null,
  "forwardedMessage": null,
  "pullRequestUrl": null
}
```

### Status Values

| Status | Meaning | Your Action |
|--------|---------|-------------|
| `registered` | Worker starting | None |
| `planning` | Exploring, creating plan | None |
| `working` | Implementing | None |
| `stuck` | Needs guidance | Provide decision |
| `complete` | PR ready | Review PR |
| `cancelled` | Cancelled | None |

## Best Practices

### Do
- Start with 2-3 workers until you're comfortable
- Let workers complete before spawning more on related code
- Trust workers to handle routine decisions
- Review PRs promptly (workers might be waiting on base branch updates)

### Don't
- Spawn 10 workers on day one
- Micromanage worker progress
- Override worker decisions without good reason
- Forget to clean up completed worktrees

## Cleanup

After PRs are merged:

```bash
git worktree remove ../project-issue-123
```

Some implementations automate this (e.g., a `/prune` command that removes worktrees for merged PRs).
