export interface LoopDefinition {
  id: string
  title: string
  description: string
  intervalMs: number
  branchPrefix: string
  promptTemplate: string
}

const HOUR = 60 * 60 * 1000

export const DEFAULT_LOOPS: LoopDefinition[] = [
  {
    id: 'test-coverage',
    title: 'Test Coverage',
    description: 'Find untested code paths and add meaningful tests to improve coverage',
    intervalMs: 8 * HOUR,
    branchPrefix: 'minions/loops/test-coverage',
    promptTemplate: `You are a senior engineer improving test coverage on this codebase.

Task: Identify the most impactful untested code paths and write tests for them. Focus on critical business logic, edge cases, and error paths. Do not write tautological tests or tests for static copy.

Run the full test suite before submitting. Ensure all existing tests continue to pass.`,
  },
  {
    id: 'type-safety',
    title: 'Type Safety',
    description: 'Eliminate type weaknesses: any casts, implicit anys, missing return types, unsafe assertions',
    intervalMs: 12 * HOUR,
    branchPrefix: 'minions/loops/type-safety',
    promptTemplate: `You are a senior engineer hardening TypeScript type safety on this codebase.

Task: Find and fix type weaknesses. Target: \`as any\`, \`as unknown as T\`, implicit \`any\` inferences, missing return type annotations on exported functions, unsafe index access, and missing null checks in critical paths.

Do not disable lint/tsc rules to silence errors — fix the underlying code. Run \`tsc --noEmit\` to confirm zero errors before submitting.`,
  },
  {
    id: 'dead-code',
    title: 'Dead Code Elimination',
    description: 'Remove unused exports, unreachable branches, and dead dependencies',
    intervalMs: 24 * HOUR,
    branchPrefix: 'minions/loops/dead-code',
    promptTemplate: `You are a senior engineer removing dead code from this codebase.

Task: Identify and remove unused exports, unreachable code branches, obsolete feature flags, dead dependencies (check package.json), and stale TODO comments for features that were already shipped or abandoned.

Be conservative: only remove code you can prove is unreachable or unused. Run typecheck and tests before submitting.`,
  },
  {
    id: 'todo-resolver',
    title: 'TODO Resolver',
    description: 'Work through TODO/FIXME/HACK comments and resolve them or convert them to tracked issues',
    intervalMs: 8 * HOUR,
    branchPrefix: 'minions/loops/todo-resolver',
    promptTemplate: `You are a senior engineer resolving deferred work in this codebase.

Task: Search for TODO, FIXME, HACK, and XXX comments. For each one, either implement the fix if it is small and well-scoped, or convert it to a GitHub issue with enough context. Remove the inline comment once the item is resolved or tracked.

Do not bite off large refactors in a single pass. Prioritise correctness issues and security-adjacent TODOs first.`,
  },
  {
    id: 'dependency-audit',
    title: 'Dependency Audit',
    description: 'Audit dependencies for known vulnerabilities, outdated versions, and unnecessary packages',
    intervalMs: 24 * HOUR,
    branchPrefix: 'minions/loops/dependency-audit',
    promptTemplate: `You are a senior engineer auditing project dependencies.

Task: Run a dependency audit. Check for known CVEs via \`npm audit\` or equivalent. Identify packages with available non-breaking updates. Flag dependencies that appear unused or could be replaced by a smaller alternative.

Only upgrade a package if: (1) the upgrade is non-breaking (semver patch or minor), or (2) a CVE demands it. Document all changes in the PR body. Run the full test suite before submitting.`,
  },
  {
    id: 'docs-sync',
    title: 'Docs Sync',
    description: 'Keep documentation in sync with the current implementation',
    intervalMs: 24 * HOUR,
    branchPrefix: 'minions/loops/docs-sync',
    promptTemplate: `You are a senior engineer keeping documentation accurate.

Task: Compare existing documentation (README, docs/, inline JSDoc/TSDoc, API comments) against the current implementation. Fix stale instructions, outdated API references, missing environment variable documentation, and broken examples.

Do not rewrite docs that are still accurate — only fix genuine inaccuracies. Verify that all code examples in docs actually compile and run.`,
  },
  {
    id: 'strictness-audit',
    title: 'Strictness Audit',
    description: 'Audit lint and compiler strictness rules and tighten any that are currently suppressed or misconfigured',
    intervalMs: 24 * HOUR,
    branchPrefix: 'minions/loops/strictness-audit',
    promptTemplate: `You are a senior engineer tightening code quality guardrails.

Task: Review the project's ESLint config, tsconfig compiler options, and any inline suppressions (\`eslint-disable\`, \`@ts-ignore\`, \`@ts-expect-error\`). For each suppressed rule or weakened strictness setting, either fix the underlying code so the suppression is no longer needed, or document why the suppression is legitimate with a concrete reason.

Never add new suppressions — only remove existing ones. Run \`tsc --noEmit\` and the linter with zero errors before submitting.`,
  },
]
