import { runDoctor, formatDoctorReport } from '../cli/doctor'

export interface DoctorCommandResult {
  ok: boolean
  text?: string
  error?: string
}

export async function handleDoctorCommand(): Promise<DoctorCommandResult> {
  try {
    const report = await runDoctor()
    const text = formatDoctorReport(report)
    const allOk = report.checks.every((c) => c.status === 'ok')
    return { ok: allOk, text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
