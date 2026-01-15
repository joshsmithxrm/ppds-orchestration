/**
 * Review verdict returned by the code review agent.
 */
export type ReviewVerdictStatus = 'APPROVED' | 'NEEDS_WORK';

/**
 * Complete review verdict with details.
 */
export interface ReviewVerdict {
  /** Whether the code is approved or needs work */
  status: ReviewVerdictStatus;
  /** Summary of the review */
  summary: string;
  /** Detailed feedback (shown to worker on NEEDS_WORK) */
  feedback?: string;
  /** List of specific issues found */
  issues?: ReviewIssue[];
  /** Confidence level (0-100) */
  confidence?: number;
}

/**
 * Individual issue found during review.
 */
export interface ReviewIssue {
  /** Severity of the issue */
  severity: 'error' | 'warning' | 'suggestion';
  /** File path where issue was found */
  file?: string;
  /** Line number */
  line?: number;
  /** Description of the issue */
  description: string;
  /** Category of the issue */
  category: ReviewCategory;
}

/**
 * Categories of review issues.
 */
export type ReviewCategory =
  | 'test'           // Missing or failing tests
  | 'pattern'        // Inconsistent with codebase patterns
  | 'security'       // Security vulnerabilities
  | 'performance'    // Performance concerns
  | 'completeness'   // Incomplete implementation
  | 'build'          // Build or compilation errors
  | 'style'          // Code style issues
  | 'other';         // Other issues

/**
 * Result of invoking the review agent.
 */
export interface ReviewResult {
  success: boolean;
  verdict?: ReviewVerdict;
  error?: string;
  /** Time taken in milliseconds */
  durationMs?: number;
}
