# Test Spawn Worker

Test the spawn worker feature in the dashboard.

## Usage

```
/test-spawn <mode> <issue>
```

### Modes

| Mode | Description |
|------|-------------|
| `mock` | Browser-only with mock data (fast, no prerequisites) |
| `integration` | Full Tauri app with real GitHub data |

### Examples

```bash
/test-spawn mock 2          # Test issue #2 with mock data
/test-spawn integration 2   # Test issue #2 with real GitHub API
/test-spawn mock            # Mock mode, will prompt for issue
/test-spawn integration     # Integration mode, will prompt for issue
```

## Instructions

Based on the arguments provided ($ARGUMENTS), test the spawn worker feature.

### Step 1: Parse arguments

Parse $ARGUMENTS to extract:
- **mode**: First argument - either `mock` or `integration`
- **issue**: Second argument - the GitHub issue number (optional, prompt if missing)

If only one argument is provided:
- If it's `mock` or `integration`: use that mode, prompt for issue number
- If it's a number: default to `mock` mode with that issue number

### Step 2: Start the appropriate server

**For mock mode:**
```bash
# Check if Vite is running on port 1420
netstat -ano | findstr :1420
```

If not running, start the Vite dev server in the background:
```bash
cd packages/dashboard && npm run dev
```

**For integration mode:**

First, verify prerequisites:
```bash
rustc --version
gh auth status
```

Ensure the CLI is built:
```bash
npm run build
```

Then start Tauri dev server in the background:
```bash
cd packages/dashboard && npm run tauri:dev
```

Wait for Tauri to compile (first run takes 2-5 minutes). Check for port 1420 to be listening.

Note: Tauri mode requires VS Build Tools and Rust toolchain.

### Step 3: Open the dashboard

Use Playwright MCP to navigate to the dashboard:

1. Call `mcp__plugin_playwright_playwright__browser_navigate` with URL `http://localhost:1420`
2. Wait for the page to load (use `mcp__plugin_playwright_playwright__browser_wait_for` with 2-3 seconds)
3. Take a snapshot to verify the page loaded correctly

**Verify mode:**
- Mock mode: Should show "Dev Mode" badge in header
- Integration mode: Should NOT show "Dev Mode" badge

### Step 4: Click the Spawn Worker button

1. Call `mcp__plugin_playwright_playwright__browser_snapshot` to get the current page state
2. Find the "+ Spawn Worker" button in the header
3. Call `mcp__plugin_playwright_playwright__browser_click` on the button

### Step 5: Enter the issue number

1. Take a snapshot to verify the modal opened
2. Find the "GitHub Issue Number" input field
3. Call `mcp__plugin_playwright_playwright__browser_type` to enter the issue number
4. Take a snapshot to verify the input

### Step 6: Submit and verify

1. Click the "Spawn" button
2. Wait 2-3 seconds for the operation to complete
3. Take a final snapshot
4. Check for:
   - Modal closed (success)
   - New worker appears in "Active Workers" list
   - Or error message displayed (if spawn failed)

### Step 7: Report results

Summarize the test:
- **Mode**: mock or integration
- **Issue**: The issue number tested
- **Result**: Success or failure
- **Session ID**: From console logs (mock) or file system (integration)
- **Errors**: Any errors encountered
- **Screenshot**: Final state of dashboard

## Key Indicators

| Result | Mock Mode | Integration Mode |
|--------|-----------|------------------|
| Success | Console: `[Mock] Spawned worker: session-X-timestamp` | New session folder in `.orch/sessions/` |
| Worker Title | `Mock Issue #N` | Real issue title from GitHub |
| Dev Badge | Shows "Dev Mode" | No badge |
| Data Source | In-memory mock | Real file watcher |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 1420 in use | Stop existing server: `taskkill /PID <pid> /F` |
| `orch` not found | Run `npm run build` first |
| GitHub auth error | Run `gh auth login` |
| Issue not found | Verify issue number exists in repo |
| Tauri won't start | Check Rust: `rustc --version` |
| First Tauri build slow | Normal - Rust compilation takes 2-5 min first time |

## Mode Comparison

| Feature | Mock Mode | Integration Mode |
|---------|-----------|------------------|
| Speed | Fast (seconds) | Slower (needs Tauri) |
| Prerequisites | Node.js only | Rust + VS Build Tools |
| Data | Fake/mock | Real GitHub API |
| File watcher | Simulated | Real file system |
| Best for | UI testing | End-to-end testing |
