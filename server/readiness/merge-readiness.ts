import path from 'node:path'
import type { MergeReadiness, MergeReadinessCheck, MergeReadinessStatus, PrCheck, PrPreview, QualityReport } from '../../shared/api-types'
import { readRepoConfig } from '../config/repo-config'
import { fetchPrPreview } from '../github/pr-preview'

export interface MergeReadinessSessionRow {
  id: string
  slug: string
  status: string
  pr_url: string | null
  workspace_root: string | null
  metadata: string | Record<string, unknown> | null
}

interface SessionMetadata {
  qualityReport?: QualityReport
}

function parseMetadata(raw: MergeReadinessSessionRow['metadata']): SessionMetadata {
  if (typeof raw === 'object' && raw !== null) return raw as SessionMetadata
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as SessionMetadata : {}
  } catch {
    return {}
  }
}

function aggregateStatus(checks: MergeReadinessCheck[]): MergeReadinessStatus {
  const required = checks.filter((check) => check.required)
  if (required.some((check) => check.status === 'blocked')) return 'blocked'
  if (required.some((check) => check.status === 'pending')) return 'pending'
  if (required.some((check) => check.status === 'unknown')) return 'unknown'
  return 'ready'
}

function checkStatus(checks: PrCheck[]): MergeReadinessStatus {
  if (checks.length === 0) return 'unknown'
  if (checks.some((check) =>
    check.status === 'failure'
    || check.status === 'timed_out'
    || check.status === 'action_required'
    || check.status === 'cancelled'
  )) return 'blocked'
  if (checks.some((check) =>
    check.status === 'queued'
    || check.status === 'in_progress'
    || check.status === 'pending'
  )) return 'pending'
  return 'ready'
}

function failedGateSummary(report: QualityReport): string {
  const failed = report.results.filter((result) => result.required && !result.passed)
  if (failed.length === 0) return 'Configured quality gates passed'
  return failed.map((result) => result.name).join(', ')
}

function repoConfigStatus(source: 'file' | 'default' | undefined, error: string | undefined): MergeReadinessStatus {
  if (error) return 'blocked'
  if (source === 'file') return 'ready'
  return 'unknown'
}

function repoConfigSummary(source: 'file' | 'default' | undefined, error: string | undefined): string {
  if (error) return 'minions.json is invalid'
  if (source === 'file') return 'minions.json loaded'
  return 'Using built-in repository defaults'
}

function mergeableStatus(value: boolean | null): MergeReadinessStatus {
  if (value === true) return 'ready'
  if (value === false) return 'blocked'
  return 'unknown'
}

function mergeableSummary(value: boolean | null): string {
  if (value === true) return 'GitHub reports the PR as mergeable'
  if (value === false) return 'GitHub reports merge conflicts'
  return 'GitHub has not reported mergeability yet'
}

function ciSummary(status: MergeReadinessStatus): string {
  if (status === 'ready') return 'All reported CI checks passed'
  if (status === 'blocked') return 'One or more CI checks failed'
  if (status === 'pending') return 'CI checks are still running'
  return 'No CI checks are reported'
}

function qualityStatus(report: QualityReport | undefined, sessionStatus: string): MergeReadinessStatus {
  if (report) return report.allPassed ? 'ready' : 'blocked'
  return sessionStatus === 'completed' ? 'unknown' : 'pending'
}

export async function buildMergeReadiness(
  row: MergeReadinessSessionRow,
  prFetcher: (prUrl: string) => Promise<PrPreview> = fetchPrPreview,
): Promise<MergeReadiness> {
  const cwd = row.workspace_root ? path.join(row.workspace_root, row.slug) : null
  const repoConfig = cwd ? readRepoConfig(cwd) : undefined
  const policy = repoConfig?.config.merge ?? {
    requirePr: true,
    requireMergeable: true,
    requireCiPass: true,
    requireQualityGates: true,
    allowDraft: false,
  }
  const checks: MergeReadinessCheck[] = []
  const metadata = parseMetadata(row.metadata)
  let pr: PrPreview | null = null
  let prError: string | null = null

  if (row.pr_url) {
    try {
      pr = await prFetcher(row.pr_url)
    } catch (err) {
      prError = err instanceof Error ? err.message : String(err)
    }
  }

  checks.push({
    id: 'repo-config',
    label: 'Repo config',
    status: repoConfigStatus(repoConfig?.source, repoConfig?.error),
    required: repoConfig?.error !== undefined,
    summary: repoConfigSummary(repoConfig?.source, repoConfig?.error),
    details: repoConfig?.error,
  })

  if (policy.requirePr) {
    checks.push({
      id: 'pull-request',
      label: 'Pull request',
      status: row.pr_url ? 'ready' : row.status === 'completed' ? 'blocked' : 'pending',
      required: true,
      summary: row.pr_url ? 'PR is linked' : 'No PR is linked yet',
      details: row.pr_url ?? undefined,
    })
  }

  if (row.pr_url && prError) {
    checks.push({
      id: 'pull-request-details',
      label: 'PR details',
      status: 'unknown',
      required: policy.requireMergeable || policy.requireCiPass,
      summary: 'GitHub PR details are unavailable',
      details: prError,
    })
  }

  if (pr && !policy.allowDraft) {
    checks.push({
      id: 'draft',
      label: 'Draft state',
      status: pr.draft ? 'blocked' : 'ready',
      required: true,
      summary: pr.draft ? 'PR is still a draft' : 'PR is not a draft',
    })
  }

  if (pr && policy.requireMergeable) {
    checks.push({
      id: 'mergeable',
      label: 'Mergeability',
      status: mergeableStatus(pr.mergeable),
      required: true,
      summary: mergeableSummary(pr.mergeable),
    })
  }

  if (pr && policy.requireCiPass) {
    const status = checkStatus(pr.checks)
    checks.push({
      id: 'ci',
      label: 'CI checks',
      status,
      required: true,
      summary: ciSummary(status),
    })
  }

  if (policy.requireQualityGates) {
    const report = metadata.qualityReport
    checks.push({
      id: 'quality-gates',
      label: 'Quality gates',
      status: qualityStatus(report, row.status),
      required: true,
      summary: report ? failedGateSummary(report) : 'No quality gate report is recorded yet',
      details: report?.configError,
    })
  }

  return {
    sessionId: row.id,
    generatedAt: new Date().toISOString(),
    status: aggregateStatus(checks),
    prUrl: row.pr_url ?? undefined,
    configPath: repoConfig?.path,
    checks,
  }
}
