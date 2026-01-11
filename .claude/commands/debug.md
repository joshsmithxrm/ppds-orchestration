# Debug Dashboard

Diagnose and fix issues in the dashboard using Playwright MCP tools.

## Usage

- `/debug <description>` - Diagnose a specific issue (e.g., "/debug there's a TypeError on the main page")
- `/debug` - General health check of the dashboard

## Example

```
/debug there's a TypeError on the main page
/debug the worker cards are not rendering
/debug styling looks broken
```

## Instructions

Based on the argument provided ($ARGUMENTS), diagnose and fix dashboard issues.

### Step 1: Check dev server status

First, verify the dashboard dev server is running on port 1420:

```bash
# Windows - check if port 1420 is in use
netstat -ano | findstr :1420
```

If the server is NOT running, start it in the background:
```bash
cd packages/dashboard && npm run dev
```

Wait a few seconds for the server to start.

### Step 2: Navigate to the dashboard

Use Playwright MCP to open the dashboard:

1. Call `playwright_navigate` with URL `http://localhost:1420`
2. Wait for the page to fully load

### Step 3: Capture diagnostic data

Use Playwright MCP tools to gather information:

1. **Screenshot**: Call `playwright_screenshot` to capture the current visual state
2. **Console logs**: Call `playwright_console` to get any JavaScript errors or warnings
3. **Page content**: If needed, call `playwright_evaluate` with `document.body.innerHTML` to inspect DOM

### Step 4: Analyze the issue

Based on the user's description ($ARGUMENTS) and the captured data:

- Look for JavaScript errors in the console output
- Check the screenshot for visual issues (blank page, broken layout, missing elements)
- Identify error patterns (e.g., "Cannot read properties of undefined")

### Step 5: Diagnose root cause

Common issues and their causes:

| Error Pattern | Likely Cause | Solution |
|---------------|--------------|----------|
| `invoke` undefined | Running in browser without Tauri | Verify tauri-mock.ts is being used |
| Blank page | Import/syntax error | Check console for module errors |
| Missing styles | Tailwind not loading | Check postcss/tailwind config |
| "Module not found" | Missing dependency | Run `npm install` |
| Network errors | Backend not running | Check Tauri backend logs |

### Step 6: Fix and verify

1. Read the relevant source files based on the error location
2. Make the necessary code changes to fix the issue
3. Refresh the page using `playwright_navigate` again
4. Take another screenshot to verify the fix worked
5. Check console for any remaining errors

### Step 7: Report findings

Summarize:
- What the issue was
- What caused it
- What was done to fix it
- Verification that the fix worked

## Notes

- The dashboard runs on `http://localhost:1420` (Vite dev server)
- When not running inside Tauri, the dashboard uses mock data from `src/lib/tauri-mock.ts`
- A "Dev Mode" badge appears in the header when running in browser-only mode
- For full Tauri functionality, use `npm run tauri:dev` instead of `npm run dev`

## Key Files

| File | Purpose |
|------|---------|
| `packages/dashboard/src/App.tsx` | Main React component |
| `packages/dashboard/src/lib/tauri-mock.ts` | Tauri API wrapper with mock fallback |
| `packages/dashboard/src/types.ts` | TypeScript interfaces |
| `packages/dashboard/src/components/` | UI components |
| `packages/dashboard/vite.config.ts` | Vite configuration |
