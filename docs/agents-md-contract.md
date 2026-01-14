# AGENTS.md Contract

Minimal operational context for headless workers (~60 lines max).

## Purpose

AGENTS.md provides workers with just enough context to complete a single task without design philosophy, historical context, or code examples that consume valuable context window tokens.

## Generated Per-Session By Orchestrator

The orchestrator generates AGENTS.md dynamically from:

- **Repo's CLAUDE.md** - distilled to top 3 NEVER/ALWAYS rules
- **Current task context** - key files for the specific task
- **Session identity** - issue number, branch name

## Required Sections

```markdown
# {Repo Name} - Worker Context

## Task
{Issue title and key requirements}

## NEVER
- {Top 3 critical anti-patterns from repo CLAUDE.md}

## ALWAYS
- {Top 3 essential patterns from repo CLAUDE.md}

## Commands
| Command | Purpose |
|---|---|
| `npm run build` | Build all packages |
| `npm run test` | Run all tests |

## Key Files
- {Task-specific files only}

## Session
- Issue: #{number}
- Branch: {branch}
```

## Excluded Content

- Design philosophy and rationale
- Historical context
- Alternative approaches
- Code examples (use file:line pointers)
- Full NEVER/ALWAYS lists (only top 3)
- Cross-repo context

## Why This Matters

Per v1 workflow documentation, workers should:

- Start fresh each iteration without carrying over state from previous runs
- Stay under 60% context utilization
- Focus on single atomic task completion

AGENTS.md keeps deterministic context minimal so workers can allocate context to actual work.
