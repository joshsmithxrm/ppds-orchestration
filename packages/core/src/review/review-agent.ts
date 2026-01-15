import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReviewResult, ReviewVerdict } from './types.js';

/**
 * Options for invoking the review agent.
 */
export interface ReviewAgentOptions {
  /** Path to the worktree to review */
  worktreePath: string;
  /** GitHub owner */
  githubOwner: string;
  /** GitHub repo name */
  githubRepo: string;
  /** Issue number being worked on */
  issueNumber: number;
  /** Path to the review agent prompt file (optional) */
  agentPromptPath?: string;
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;
}

/**
 * Default path to the example agent prompt.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_AGENT_PATH = path.join(__dirname, '..', '..', '..', 'examples', 'agents', 'code-review-agent.md');

/**
 * Invokes the code review agent to review changes in a worktree.
 *
 * The agent is invoked via Claude CLI with a review prompt that instructs it to:
 * 1. Check test coverage and passing status
 * 2. Verify code follows codebase patterns
 * 3. Check for security issues
 * 4. Verify completeness against the issue
 * 5. Return a JSON verdict
 *
 * @param options - Review options including worktree path and configuration
 * @returns ReviewResult with verdict or error
 */
export async function invokeReviewAgent(options: ReviewAgentOptions): Promise<ReviewResult> {
  const {
    worktreePath,
    githubOwner,
    githubRepo,
    issueNumber,
    agentPromptPath,
    timeoutMs = 300_000,
  } = options;

  const startTime = Date.now();

  // Load the agent prompt
  let agentPrompt: string;
  try {
    const promptPath = agentPromptPath || DEFAULT_AGENT_PATH;
    if (fs.existsSync(promptPath)) {
      agentPrompt = await fs.promises.readFile(promptPath, 'utf-8');
    } else {
      // Use fallback prompt if file doesn't exist
      agentPrompt = buildFallbackPrompt();
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to load review agent prompt: ${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - startTime,
    };
  }

  // Build the full prompt with context
  const fullPrompt = buildReviewPrompt(agentPrompt, {
    githubOwner,
    githubRepo,
    issueNumber,
  });

  return new Promise((resolve) => {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: `Review agent timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - startTime,
      });
    }, timeoutMs);

    // Spawn Claude CLI for review
    const proc = spawn('claude', [
      '--dangerously-skip-permissions',
      fullPrompt,
    ], {
      cwd: worktreePath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      if (code !== 0) {
        resolve({
          success: false,
          error: `Review agent exited with code ${code}: ${stderr}`,
          durationMs,
        });
        return;
      }

      // Parse the JSON verdict from output
      try {
        const verdict = parseVerdictFromOutput(stdout);
        resolve({
          success: true,
          verdict,
          durationMs,
        });
      } catch (error) {
        resolve({
          success: false,
          error: `Failed to parse review verdict: ${error instanceof Error ? error.message : String(error)}`,
          durationMs,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: `Failed to spawn review agent: ${error.message}`,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

/**
 * Builds the full review prompt with context.
 */
function buildReviewPrompt(
  basePrompt: string,
  context: { githubOwner: string; githubRepo: string; issueNumber: number }
): string {
  return `${basePrompt}

## Context
- Repository: ${context.githubOwner}/${context.githubRepo}
- Issue: #${context.issueNumber}
- Task: Review the code changes in this worktree

## Instructions
1. Review all changes in the current worktree
2. Check for test coverage, code patterns, security, and completeness
3. Output your verdict as JSON in a code fence like this:

\`\`\`json
{
  "status": "APPROVED" | "NEEDS_WORK",
  "summary": "Brief summary of review",
  "feedback": "Detailed feedback if NEEDS_WORK",
  "issues": [],
  "confidence": 85
}
\`\`\`

Begin your review now.`;
}

/**
 * Parses the verdict JSON from the agent's output.
 */
function parseVerdictFromOutput(output: string): ReviewVerdict {
  // Look for JSON in code fence
  const jsonMatch = output.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }

  // Try to find raw JSON object
  const jsonObjectMatch = output.match(/\{[\s\S]*"status"[\s\S]*\}/);
  if (jsonObjectMatch) {
    return JSON.parse(jsonObjectMatch[0]);
  }

  throw new Error('No JSON verdict found in output');
}

/**
 * Builds a fallback prompt when the agent file doesn't exist.
 */
function buildFallbackPrompt(): string {
  return `# Code Review Agent

You are a code review agent. Your job is to review code changes and provide a verdict.

## Review Criteria
1. **Tests**: Are there tests? Do they pass?
2. **Patterns**: Does the code follow existing patterns in the codebase?
3. **Security**: Are there any security vulnerabilities?
4. **Completeness**: Does the implementation fully address the issue?
5. **Build**: Does the code compile/build without errors?

## Output Format
You MUST output your verdict as JSON.`;
}
