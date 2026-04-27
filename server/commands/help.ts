export interface HelpCommandResult {
  ok: boolean
  text: string
}

const HELP_TEXT = `**Task / Plan / Think / Review**
  /task <prompt>       Start a small implementation task
  /w <prompt>          Alias for /task
  /plan <prompt>       Start a planning session for later execution
  /think <prompt>      Start a research/brainstorm session
  /review <prompt>     Start a review session

**Ship**
  /ship <prompt>       Start a full ship coordinator session

**DAG / Split / Stack**
  /dag [markdown]      Build and run a DAG from markdown or last assistant message
  /split               Split plan into parallel tasks and run them
  /stack               Stack plan into sequential tasks and run them
  /execute [direction] Execute plan from session; optional direction overrides default item-picking
  /judge [markdown]    Run judge orchestrator on the session conversation
  /retry <nodeId> <dagId>       Retry a failed DAG node
  /force <nodeId> <dagId>       Force a DAG node to landed state
  /land <nodeId> <dagId>        Land a DAG node (merge PR)
  /land [all-or-nothing|best-effort]  Land all ready PRs in a session's DAG; default best-effort

**Status**
  /status [sessionId]  Summary of sessions
  /stats [days]        Usage stats for the last N days (default: 30)
  /usage               Stats for the current month

**Session Control**
  /reply <text>        Reply to the active session
  /r <text>            Alias for /reply
  /done [sessionId]    Mark session completed
  /stop [sessionId]    Stop a running session
  /close [sessionId]   Stop and remove a session

**Loops**
  /loops list          List all loop definitions and status
  /loops enable <id>   Enable a loop
  /loops disable <id>  Disable a loop

**Config**
  /config show         Show runtime config
  /config set key=val  Override a runtime config value

**Utility**
  /clean               Sweep stale sessions and free disk space
  /doctor              Run diagnostic checks
  /help                Show this help`

export function handleHelpCommand(): HelpCommandResult {
  return { ok: true, text: HELP_TEXT }
}
