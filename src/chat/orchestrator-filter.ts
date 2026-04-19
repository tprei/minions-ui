// Server-authored orchestrator status messages arrive in TopicSession.conversation
// via `ctx.postStatus` (see telegram-minions/src/engine/engine-context.ts). Telegram
// users see them in their thread; the PWA hides them in favour of the live DAG /
// status panels that read from `store.dags` and `store.sessions` directly.
//
// The filter matches plain-text prefixes the server emits. Lines authored by
// humans (e.g. `/retry`, a user reply) don't match these patterns and pass
// through untouched.

const ORCHESTRATOR_PREFIXES = [
  '🔗 DAG:',
  '🔗 DAG ',
  '📊 🔗 DAG Status',
  '📊 DAG complete:',
  '📚 Stack:',
  '⚡ Starting:',
  '⚡ DAG recovered after restart',
  '🔄 ',
  '📊 ',
  '✅ Ship complete',
  '🚢 Ship:',
  '⚖️ Verdict',
  '🗣 Advocate:',
  '⏳ Pipeline is advancing',
]

const ORCHESTRATOR_REGEX_TESTS: RegExp[] = [
  /^✅ [\w-]+ (?:\(https?:\/\/[^)]+\) )?completed:/,
  /^❌ [\w-]+ (?:\(https?:\/\/[^)]+\) )?failed:/,
  /^⚠️ [\w-]+ completed without a PR/,
  /^⚠️ Pre-flight failed/,
  /^🔍 Pre-flight check/,
]

export function isOrchestratorStatus(text: string): boolean {
  const trimmed = text.trimStart()
  for (const prefix of ORCHESTRATOR_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }
  for (const regex of ORCHESTRATOR_REGEX_TESTS) {
    if (regex.test(trimmed)) return true
  }
  return false
}
