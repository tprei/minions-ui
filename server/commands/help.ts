export interface HelpCommandResult {
  ok: boolean
  text: string
}

const HELP_TEXT = `**Task / Plan / Think / Review**
  /task <prompt>       Start a task session
  /w <prompt>          Alias for /task
  /plan <prompt>       Start a plan session
  /think <prompt>      Start a think session
  /review <prompt>     Start a review session

**Ship**
  /ship <prompt>       Start a ship-think session

**DAG / Split / Stack**
  /dag [markdown]      Build and run a DAG from markdown or last assistant message
  /split               Split plan into parallel tasks and run them
  /stack               Stack plan into sequential tasks and run them
  /execute             Extract and execute plan from current session
  /judge [markdown]    Run judge orchestrator on the session conversation
  /retry <nodeId> <dagId>       Retry a failed DAG node
  /force <nodeId> <dagId>       Force a DAG node to landed state
  /land <nodeId> <dagId>        Land a DAG node (merge PR)

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
