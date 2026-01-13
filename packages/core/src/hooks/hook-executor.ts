import { spawn } from 'node:child_process';
import type { HookConfig } from '../config/central-config.js';
import type { SessionState } from '../session/types.js';

/**
 * Context provided to hooks for variable substitution.
 */
export interface HookContext {
  session: SessionState;
  repoId: string;
  worktreePath: string;
}

/**
 * Result of executing a hook.
 */
export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

/**
 * Executes command hooks with variable substitution.
 * Prompt hooks are handled elsewhere (injected into worker prompts).
 */
export class HookExecutor {
  /**
   * Execute a hook if it's a command type.
   * Returns null for prompt hooks (handled elsewhere).
   */
  async execute(
    hook: HookConfig,
    context: HookContext
  ): Promise<HookResult | null> {
    if (hook.type !== 'command') {
      return null; // Prompt hooks are handled elsewhere
    }

    const command = this.substituteVariables(hook.value, context);
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Use shell to execute command
      const proc = spawn(command, [], {
        cwd: context.worktreePath,
        shell: true,
        stdio: 'pipe',
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
        const duration = Date.now() - startTime;
        resolve({
          success: code === 0,
          output: stdout.trim() || undefined,
          error: stderr.trim() || undefined,
          duration,
        });
      });

      proc.on('error', (error) => {
        const duration = Date.now() - startTime;
        resolve({
          success: false,
          error: error.message,
          duration,
        });
      });
    });
  }

  /**
   * Execute a hook by name from a hooks map.
   * Returns null if hook doesn't exist or is a prompt hook.
   */
  async executeByName(
    hookName: string,
    hooks: Record<string, HookConfig>,
    context: HookContext
  ): Promise<HookResult | null> {
    const hook = hooks[hookName];
    if (!hook) {
      return null;
    }
    return this.execute(hook, context);
  }

  /**
   * Substitute context variables in command string.
   *
   * Available variables:
   * - ${sessionId} - Session ID (usually issue number as string)
   * - ${issueNumber} - Issue number
   * - ${repoId} - Repository ID from config
   * - ${worktreePath} - Path to worker's worktree
   * - ${branch} - Git branch name
   * - ${status} - Current session status
   * - ${issueTitle} - Issue title
   */
  private substituteVariables(command: string, context: HookContext): string {
    return command
      .replace(/\$\{sessionId\}/g, context.session.id)
      .replace(/\$\{issueNumber\}/g, context.session.issueNumber.toString())
      .replace(/\$\{repoId\}/g, context.repoId)
      .replace(/\$\{worktreePath\}/g, context.worktreePath)
      .replace(/\$\{branch\}/g, context.session.branch)
      .replace(/\$\{status\}/g, context.session.status)
      .replace(/\$\{issueTitle\}/g, context.session.issueTitle);
  }
}
