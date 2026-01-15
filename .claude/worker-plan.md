# Worker Plan: Issue #2 - Hello World Script

## Goal
Create a simple hello world script to validate the full worker lifecycle with 3 sequential tasks.

## Implementation Steps

1. **Task 1: Create hello.ts script** - Create `scripts/` folder and basic hello.ts
2. **Task 2: Add greeting function with parameter** - Add `greet(name)` function with argv parsing
3. **Task 3: Add timestamp to output** - Modify greet() to append `Date.now()` in brackets

## Acceptance Criteria Checklist
- [x] `scripts/` directory exists at repository root
- [x] `scripts/hello.ts` exists and is executable with tsx
- [x] Running with no args outputs greeting with timestamp
- [x] Running with name arg uses that name in greeting

## Verification Results
```
$ npx tsx scripts/hello.ts
Hello, orchestration! [1768505750769]

$ npx tsx scripts/hello.ts Claude
Hello, Claude! [1768505753666]

$ npx tsx scripts/hello.ts Test
Hello, Test! [1768505757044]
```

## Notes
- Using `tsx` for TypeScript execution (already available via npx)
- No additional dependencies needed
- All 3 tasks completed successfully
