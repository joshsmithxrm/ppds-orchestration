# Debug Dashboard

Diagnose and fix issues in the web dashboard using Playwright MCP tools.

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

First, verify the web dev server is running on port 5173:

```bash
# Windows - check if port 5173 is in use
netstat -ano | findstr :5173
```

If the server is NOT running, start it in the background:
```bash
npm run dev -w packages/web
```

Wait a few seconds for the server to start.

### Step 2: Navigate to the dashboard

Use Playwright MCP to open the dashboard:

1. Call `playwright_navigate` with URL `http://localhost:5173`
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
| Blank page | Import/syntax error | Check console for module errors |
| Missing styles | Tailwind not loading | Check postcss/tailwind config |
| "Module not found" | Missing dependency | Run `npm install` |
| Network errors | Backend not running | Check if both server and client are running |
| API fetch failed | Backend API endpoint error | Check server logs |

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

- The web dashboard runs two processes: Vite frontend (port 5173) and Express backend (port 3847)
- Use `npm run dev -w packages/web` to start both concurrently
- Access via Vite port (5173), not backend port (3847)
- WebSocket real-time updates may not work in dev mode (use production build for full testing)

## Key Files

| File | Purpose |
|------|---------|
| `packages/web/src/App.tsx` | Main React component |
| `packages/web/src/pages/Dashboard.tsx` | Dashboard page component |
| `packages/web/src/components/` | UI components |
| `packages/web/server/index.ts` | Express backend server |
| `packages/web/server/routes/` | API route handlers |
| `packages/web/vite.config.ts` | Vite configuration |
