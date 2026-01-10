# Human Gates

When workers should stop and escalate to human.

## The Principle

Workers are autonomous for **implementation**. Humans own **decisions**.

Workers should make progress without asking permission for routine work. But some decisions are too important, too sensitive, or too ambiguous for workers to make alone.

## Gate Types

### 1. Design Gate

**When:** Starting work that needs strategic direction.

**Examples:**
- "Should this be a new component or extend the existing one?"
- "There are three ways to implement this - which fits the project direction?"
- "This issue is vague - what's the actual requirement?"

**Action:** Worker stops, describes the decision needed, waits for guidance.

### 2. Domain Gates

**When:** Implementation touches sensitive areas.

| Domain | Examples |
|--------|----------|
| **Security/Auth** | Token handling, credentials, permissions, encryption |
| **Performance** | Algorithms with O(n²) or worse, bulk operations, caching strategies |
| **Data/Schema** | Database migrations, breaking schema changes |
| **External APIs** | Third-party integrations, API key handling |

**Action:** Worker stops, describes what it's about to do, waits for approval.

**Why:** These areas have non-obvious gotchas. A human familiar with the domain can spot issues a worker might miss.

### 3. Stuck Gate

**When:** Worker can't make progress.

| Trigger | Description |
|---------|-------------|
| Test failure loop | Same test failing after 3+ fix attempts |
| CI failure loop | CI failing after 3+ fix attempts |
| Unclear requirements | Issue doesn't specify enough to implement |
| Missing access | Needs credentials, permissions, or resources worker doesn't have |
| Merge conflict | Can't automatically resolve |

**Action:** Worker stops, describes what's blocking and what was tried, waits for help.

### 4. PR Review Gate

**When:** Work is complete, PR is ready.

**Action:** Worker marks complete with PR URL. Human reviews the code and merges.

**Why:** Human is final quality gate. Workers never merge their own PRs.

## Escalation Format

When escalating, workers should provide:

```markdown
## Stuck: [Brief description]

### Context
[What were you trying to do]

### What I Tried
[List of attempts]

### Options Considered
[If a decision is needed, list the options]

### What I Need
[Specific help needed to proceed]
```

## Escalation Method

**Collect and batch** - don't interrupt for every small thing.

Workers should:
1. Note questions as they arise
2. Continue working on what they can
3. Escalate at natural pause points (end of exploration, before major change)
4. Bundle related questions together

**Bad:** "Should I use camelCase or snake_case?" (follow existing patterns)
**Good:** "I need clarity on the auth approach before implementing the token refresh logic"

## What Workers Handle Alone

| Decision | Worker Handles? |
|----------|-----------------|
| Code style | Yes - follow existing patterns |
| Which test framework | Yes - use what project uses |
| Variable names | Yes - be consistent |
| Error messages | Yes - be clear and helpful |
| Minor refactoring | Yes - if it helps the task |
| Adding dependencies | Maybe - escalate if major/unusual |
| Changing public APIs | No - escalate |
| Security implementation | No - escalate |
| Performance tradeoffs | No - escalate |

## The Trust Gradient

```
Full autonomy                                    Always escalate
     │                                                  │
     ▼                                                  ▼
Code style ─── Test fixes ─── Minor refactoring ─── Auth ─── Architecture
```

Workers should lean toward autonomy for routine work and lean toward escalation for sensitive work. When in doubt, escalate.

## Anti-Patterns

### Over-escalating
"Should I add a blank line here?"

**Fix:** Use judgment. Follow existing patterns. Escalate meaningful decisions.

### Under-escalating
"I implemented my own JWT library since the existing one seemed old."

**Fix:** Escalate architectural decisions. Escalate security decisions. When in doubt, ask.

### Vague Escalations
"I'm stuck."

**Fix:** Describe what's blocking, what was tried, what options exist.

### Blocking on Non-Blockers
"Waiting for approval on my plan before I explore the codebase."

**Fix:** Exploration is autonomous. Only escalate decisions that would change your direction.
