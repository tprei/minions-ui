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

export function parseCompletenessResult(output: string): { passed: boolean; details: string } {
  const lower = output.toLowerCase()
  const passed = lower.includes("passed") || lower.includes("complete") || lower.includes("success")
  return { passed, details: output }
}
