# Claude Code Guidelines for ppds-orchestration

## Project Overview

This is a TypeScript monorepo implementing an orchestration system for parallel Claude Code workers. It extracts the orchestration pattern from PPDS into a standalone, reusable tool.

## Repository Structure

```
ppds-orchestration/
├── packages/
│   ├── core/           # Core TypeScript library
│   │   └── src/
│   │       ├── session/    # Session state, store, service
│   │       ├── spawner/    # Worker spawning (Windows Terminal)
│   │       ├── watcher/    # File watching for real-time updates
│   │       └── git/        # Git utilities (worktrees, status)
│   │
│   ├── cli/            # CLI tool (`orch` command)
│   │   └── src/
│   │       └── commands/   # Individual CLI commands
│   │
│   └── web/            # React web dashboard
│
├── docs/               # Conceptual documentation
├── templates/          # Worker prompt templates
└── orchestration.config.json  # Project configuration
```

## Build Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Build specific package
cd packages/core && npm run build
cd packages/cli && npm run build

# Run tests
npm run test
```

## Key Concepts

### Session Lifecycle
- `registered` → `planning` → `planning_complete` → `working` → `shipping` → `pr_ready` → `complete`
- Workers can enter `stuck` state when they need guidance
- Sessions can be `paused` or `cancelled`

### Worker Context Files
Each worker worktree contains:
- `session-context.json` - Static identity including `sessionFilePath` (path to main session file)
- `.claude/session-prompt.md` - Human-readable workflow instructions

### Status Reporting
Workers update status by modifying the main session file directly:
1. Read `session-context.json` to get `sessionFilePath`
2. Read the session file, update `status` and `lastHeartbeat`
3. Write the updated JSON back

The `SessionWatcher` detects changes to main session files and broadcasts updates via WebSocket.

## Coding Standards

### TypeScript
- Use strict TypeScript (strict: true in tsconfig)
- Use Zod for runtime validation of JSON files
- Use ES modules (type: "module" in package.json)
- Export types separately using `export type` when needed

### File Organization
- One concern per file
- Keep files under 500 lines when possible
- Use index.ts for barrel exports

### Error Handling
- Throw descriptive errors with context
- Use try/catch for file operations
- Validate inputs with Zod schemas

### Testing
- Use Vitest for testing
- Test files alongside source as `*.test.ts`
- Mock file system and external commands in tests

## Common Tasks

### Adding a new CLI command
1. Create `packages/cli/src/commands/<command>.ts`
2. Export the command function
3. Add to `packages/cli/src/index.ts`

### Adding a new session status
1. Add to `SessionStatus` enum in `packages/core/src/session/types.ts`
2. Update status icons/colors in CLI list command
3. Update session service if new transitions are needed

### Testing the CLI
```bash
cd packages/cli
npm run dev -- list        # Run list command
npm run dev -- spawn 1     # Spawn worker for issue #1
```

## GitHub Integration

The CLI uses `gh` CLI for GitHub operations. Ensure `gh` is authenticated:
```bash
gh auth status
```

## Worker Prompt Structure

Worker prompts include:
1. Repository context (owner, repo, issue, branch)
2. Issue details (title, body)
3. Status reporting commands
4. Workflow phases (planning → implementation → shipping)
5. Domain gates (when to escalate)

## Web Dashboard

### Running in Dev Mode
```bash
npm run dev -w packages/web
```

- Backend API: `http://localhost:3847`
- Vite dev server: `http://localhost:5173` (auto-increments if port busy)
- **Access via Vite port** (e.g., `http://localhost:5173`), not backend port
- WebSocket real-time updates won't work in dev mode (Vite doesn't proxy WS)
- For full WebSocket testing, use production build: `npm run build && npm run start -w packages/web`
