export function buildCompletenessReviewPrompt(
  title: string,
  description: string,
  branch: string,
  prUrl: string,
): string {
  return [
    `## Completeness Review: ${title}`,
    ``,
    description,
    ``,
    `Branch: ${branch}`,
    `PR: ${prUrl}`,
  ].join("\n")
}

export interface VerifyTask {
  title: string
  description: string
  branch: string | null
  prUrl: string | null
}

export function buildVerifyDirective(tasks: VerifyTask[]): string {
  const header = [
    'All implementation tasks have completed. Review the work and verify quality.',
    '',
    'Each task ran in its own isolated worktree on its own branch and was pushed as a separate PR — the changes are NOT present in your current working directory. Use `git` and `gh` to inspect each branch/PR remotely (e.g. `gh pr view <url>`, `gh pr diff <url>`, `git fetch origin <branch> && git log origin/<branch>`).',
    '',
  ]

  const taskBlocks = tasks.length === 0
    ? ['No child tasks were recorded for this ship — verify based on the original request alone.']
    : tasks.map((t, i) => {
        const lines = [`### Task ${i + 1}: ${t.title}`]
        if (t.description) lines.push('', t.description)
        lines.push('', `Branch: ${t.branch ?? '(none recorded)'}`, `PR: ${t.prUrl ?? '(none recorded)'}`)
        return lines.join('\n')
      })

  const footer = [
    '',
    'For each task above:',
    '1. Check that the changes on the branch/PR match the task description.',
    '2. Review test coverage and CI results on the PR.',
    '3. Note any regressions, gaps, or breaking changes.',
    '',
    'Then confirm whether the overall solution addresses the original request, or describe what still needs fixing.',
  ]

  return [...header, ...taskBlocks, ...footer].join('\n')
}

export function parseCompletenessResult(output: string): { passed: boolean; details: string } {
  const lower = output.toLowerCase()
  const passed = lower.includes("passed") || lower.includes("complete") || lower.includes("success")
  return { passed, details: output }
}
