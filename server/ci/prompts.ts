import type { CheckRun } from "../github/pr-preview"
import type { QualityReport } from "../handlers/types"

export function buildCIFixPrompt(prUrl: string, failedChecks: CheckRun[]): string {
  const checkLines = failedChecks
    .map((c) => `- ${c.name}: ${c.conclusion ?? c.status}${c.url ? ` (${c.url})` : ""}`)
    .join("\n")

  return [
    `CI checks are failing on PR: ${prUrl}`,
    "",
    "Failed checks:",
    checkLines,
    "",
    "Investigate the failures, fix the underlying issues in the codebase, commit the fixes, and push.",
    "Do not suppress errors with lint/type-check overrides — fix the root cause.",
  ].join("\n")
}

export function buildQualityGateFixPrompt(report: QualityReport): string {
  const failed = report.results.filter((r) => !r.passed)
  const lines = failed.map((r) => `### ${r.name}\n\`\`\`\n${r.output}\n\`\`\``).join("\n\n")

  return [
    "Local quality gates failed. Fix all issues before pushing.",
    "",
    lines,
    "",
    "Do not suppress errors — fix the underlying code.",
  ].join("\n")
}

export function buildMergeConflictPrompt(prUrl: string, conflictPaths: string[]): string {
  const pathLines = conflictPaths.map((p) => `- ${p}`).join("\n")

  return [
    `Merge conflicts detected on PR: ${prUrl}`,
    "",
    "Conflicting files:",
    pathLines,
    "",
    "Resolve all merge conflicts, keeping the intent of both sides where possible.",
    "After resolving, stage and commit the resolved files, then push.",
  ].join("\n")
}
