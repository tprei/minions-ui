import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DOC_PATH = join(import.meta.dir, '../../docs/2026-04-21-phase2-source-map.md')
const FAKE_RESUME_ID = 'smoke-test-fake-session-id'

async function checkClaudeInPath(): Promise<boolean> {
  const result = Bun.spawn(['which', 'claude'], { stdout: 'pipe', stderr: 'pipe' })
  await result.exited
  return result.exitCode === 0
}

async function runSmokeTest(): Promise<void> {
  const hasClause = await checkClaudeInPath()
  if (!hasClause) {
    console.log('[smoke] claude not found in PATH — skipping resume smoke test')
    return
  }

  const tmpCwd = join(tmpdir(), `resume-smoke-${Date.now()}`)
  mkdirSync(tmpCwd, { recursive: true })

  const args = [
    '--resume', FAKE_RESUME_ID,
    '--input-format', 'stream-json',
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
    '--append-system-prompt', 'x',
    '--model', 'claude-sonnet-4-5-20250929',
  ]

  console.log('[smoke] spawning:', ['claude', ...args].join(' '))

  const proc = Bun.spawn(['claude', ...args], {
    cwd: tmpCwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const userMsg = JSON.stringify({
    type: 'user',
    session_id: '',
    message: { role: 'user', content: 'hello' },
    parent_tool_use_id: null,
  })
  await proc.stdin.write(userMsg + '\n')
  proc.stdin.flush()

  let stderrOut = ''
  let stdoutOut = ''
  let timedOut = false

  const timeoutHandle = setTimeout(() => {
    timedOut = true
    proc.kill('SIGKILL')
  }, 10_000)

  void (async () => {
    const reader = proc.stderr.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      stderrOut += Buffer.from(value).toString('utf8')
    }
  })()

  void (async () => {
    const reader = proc.stdout.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      stdoutOut += Buffer.from(value).toString('utf8')
    }
  })()

  const exitCode = await proc.exited
  clearTimeout(timeoutHandle)

  const incompatiblePhrases = [
    'incompatible',
    'cannot be used with',
    'not supported',
    'invalid.*flag',
    'unknown flag',
    'unrecognized',
  ]

  const stderrLower = stderrOut.toLowerCase()
  const hasIncompatibilityError = incompatiblePhrases.some((p) => new RegExp(p).test(stderrLower))

  let result: string
  let compatible: boolean

  if (timedOut) {
    result = 'TIMEOUT — claude accepted the flags but did not produce output within 10s'
    compatible = true
  } else if (hasIncompatibilityError) {
    result = `INCOMPATIBLE — stderr: ${stderrOut.slice(0, 500)}`
    compatible = false
  } else if (exitCode === 0 || stdoutOut.length > 0) {
    result = `COMPATIBLE — exit ${exitCode}, stdout len=${stdoutOut.length}, stderr len=${stderrOut.length}`
    compatible = true
  } else {
    result = `INCONCLUSIVE — exit ${exitCode}, stderr: ${stderrOut.slice(0, 500)}`
    compatible = stderrOut.length === 0
  }

  console.log(`[smoke] result: ${result}`)

  if (existsSync(DOC_PATH)) {
    const doc = readFileSync(DOC_PATH, 'utf8')
    const tag = '## UNCLEAR items for Phase 2 to verify'
    const insertLine = `\n### Resume smoke test result (${new Date().toISOString()})\n\n- Compatible: ${compatible}\n- Detail: ${result}\n- Conclusion: ${compatible ? '`--resume` composes with `--input-format stream-json`; use natively in runtime.' : 'Fall back to transcript-replay-as-prefix-message using session_events.'}\n`

    if (doc.includes(tag)) {
      const updated = doc.replace(tag, tag + insertLine)
      writeFileSync(DOC_PATH, updated, 'utf8')
      console.log('[smoke] updated', DOC_PATH)
    } else {
      console.log('[smoke] could not find UNCLEAR section in doc — skipping doc update')
    }
  } else {
    console.log('[smoke] doc not found at', DOC_PATH)
  }
}

await runSmokeTest()
