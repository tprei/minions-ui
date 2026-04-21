import { runDoctor, formatDoctorReport } from './doctor'

const args = process.argv.slice(2)
const subcommand = args[0]

if (subcommand === '--version') {
  const pkg = await import('../../package.json', { with: { type: 'json' } })
  console.log(pkg.default.version)
  process.exit(0)
}

if (subcommand === 'doctor') {
  const report = await runDoctor()
  console.log(formatDoctorReport(report))
  const hasFail = report.checks.some((c) => c.status === 'fail')
  process.exit(hasFail ? 1 : 0)
}

await import('../index')
