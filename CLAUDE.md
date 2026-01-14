# PPDS Orchestration

TypeScript monorepo for parallel Claude Code worker orchestration.

## NEVER

- Commit secrets or API keys
- Use synchronous file I/O in hot paths
- Create circular imports between packages
- Skip Zod validation for external data

## ALWAYS

- Use strict TypeScript (`strict: true`)
- Validate JSON files with Zod schemas
- One concern per file, under 500 lines
- Test files alongside source as `*.test.ts`

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run build` | Build all packages |
| `npm run test` | Run Vitest tests |
| `npm run dev -w packages/cli` | Run CLI in dev mode |

## Key Concepts

- **Session Lifecycle**: `registered` → `planning` → `working` → `shipping` → `complete`
- **Worker Context**: `session-context.json` contains identity and `sessionFilePath`
- **Status Updates**: Workers modify main session file directly

## Packages

| Package | Purpose |
|---------|---------|
| `core/` | Session state, store, service, git utilities |
| `cli/` | `orch` command-line tool |
| `web/` | React dashboard with WebSocket updates |

## Key Files

- `packages/core/src/session/types.ts` - Session and status types
- `packages/cli/src/commands/` - CLI command implementations
- `templates/` - Worker prompt templates
- `orchestration.config.json` - Project configuration

## See Also

- `docs/` - Conceptual documentation
- `docs/agents-md-contract.md` - AGENTS.md generation contract
