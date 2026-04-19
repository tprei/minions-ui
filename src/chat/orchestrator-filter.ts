// Server-authored orchestrator status messages arrive in
// TopicSession.conversation via `ctx.postStatus`. Most of these are valuable
// timeline events (CI waits, child completions, merge-conflict warnings, DAG
// progress) that Conductor-style timelines keep visible. The PWA only hides
// the two verbose *snapshot* dumps that the live DagStatusPanel already
// renders at the top of the chat — showing them in the conversation would
// duplicate the panel for the same moment in time.

const ORCHESTRATOR_PREFIXES = [
  '📊 🔗 DAG Status',
  '📊 📚 Stack Status',
]

export function isOrchestratorStatus(text: string): boolean {
  const trimmed = text.trimStart()
  for (const prefix of ORCHESTRATOR_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }
  return false
}
