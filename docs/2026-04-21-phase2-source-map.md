# Phase 2 source map — session runtime

Source: `/home/prei/minions/telegram-minions/src/`. All citations below are file:line in that tree.

## 1. `sdk-session.ts` spawn and lifecycle

### 1.1 claude argv (sdk-session.ts:460-494)

```ts
const args = [
  "--print",
  "--output-format", "stream-json",
  "--input-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--dangerously-skip-permissions",
  "--no-session-persistence",                    // drop in new runtime; use --resume instead
  ...(opts.disallowedTools ? ["--disallowed-tools", ...opts.disallowedTools] : []),
  ...this.buildClaudeMcpConfigArgs(),            // ["--mcp-config", JSON.stringify({mcpServers:{...}})]
  "--append-system-prompt", opts.systemPrompt,
  "--model", opts.model,
]
// No positional prompt arg. Initial task goes via stdin NDJSON.
this.process = spawn("claude", args, {
  cwd: this.meta.cwd,
  env,
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,            // own process group; required for killProcessGroup
})
```

`READONLY_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit"]` (sdk-session.ts:19). Applied to plan/think/ship-think/review/dag-review/ship-plan. Task and ship-verify pass none.

Mode → (model, systemPrompt, disallowedTools) map at sdk-session.ts:74-113 (`claudeModeConfigs`). For new runtime, port this map and add `ci-fix`.

### 1.2 stdin NDJSON protocol

**Initial message** (sdk-session.ts:484-491):
```ts
JSON.stringify({
  type: "user",
  session_id: "",
  message: { role: "user", content: opts.task },
  parent_tool_use_id: null,
}) + "\n"
```

**Injected reply, text-only** (sdk-session.ts:145-191):
```ts
{ type: "user", session_id: "",
  message: { role: "user", content: "<text>" },
  parent_tool_use_id: null }
```

**With images** (content becomes array of blocks):
```ts
{ type: "user", session_id: "",
  message: {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "<base64>" } },
      // ... one block per image ...
      { type: "text", text: "<text>" }
    ]
  },
  parent_tool_use_id: null }
```

Media type by extension: `.png`→`image/png`, `.gif`→`image/gif`, `.webp`→`image/webp`, else `image/jpeg`. Image read failures are logged + skipped; text still sent.

**Backpressure**: current code fire-and-forgets `stdin.write(line + "\n", cb)`. New runtime should `await new Promise(r => stdin.write(line, r))` to respect backpressure.

### 1.3 stdout parse loop

`readline.createInterface({ input: proc.stdout })`. Each non-empty line → `JSON.parse` → `translateClaudeEvents(raw)` (see §2).

Special handling:
- On a `complete` event: copies `total_tokens`, `total_cost_usd`, `num_turns` to meta.
- **Idle synthesis** (sdk-session.ts:510-513): after forwarding `complete`, flip state to `idle` and synthesize an extra `{ type: "idle" }` event — because `--no-session-persistence` still keeps the process alive on stream-json stdin.

### 1.4 Stop semantics

- `interrupt()`: SIGINT → process group (sdk-session.ts:210-214).
- `kill(gracefulMs=5000)`: SIGINT → (wait gracefulMs) → SIGKILL → process group (sdk-session.ts:216-240). **No SIGTERM in between.**
- `killProcessGroup` uses `process.kill(-pid, sig)` on the detached PG; fallback to `proc.kill(sig)`.

### 1.5 Timeouts

- **Hard session timeout** (sdk-session.ts:623-643): warn + Sentry + `interrupt()`.
- **Inactivity timeout** (sdk-session.ts:528-558): reset on every stdout line and every stderr chunk. On fire: warn + Sentry (`"SDK session inactivity timeout"`) + `interrupt()`.

### 1.6 Error classification (close handler, sdk-session.ts:576-607)

- `code === 0` → `completed`.
- `code !== 0`:
  - `isQuotaError(stderrText)` matches → `{ type: "quota_exhausted", resetAt, rawMessage }`, state `errored`, done `quota_exhausted`. **Retryable** at engine layer.
  - else → `errored`. **Fatal today**, no stalled-stream retry.

The **new runtime must** (a) emit a dedicated `session.completed{state:"errored", cause:"stream_stalled"}`  or similar when the inactivity timer triggered the kill, (b) the engine must treat `stream_stalled` as a single-auto-retry class, (c) the runtime's try/finally must *always* emit the terminal `session.completed` so we never see zombie RUNNING rows.

### 1.7 Quota detection (`quota-detection.ts`)

Regex patterns (case-insensitive): `usage.*limit`, `rate.*limit`, `quota.*exceeded`, `out of.*usage`, `hit.*limit`, `exceeded.*(usage|rate|quota)`, `usage.*resets?|renews?`, `max.*(usage|tokens).*reached|exceeded`, `capacity.*(reached|exceeded|limit)`, `too many requests`, `plan.*(usage|limit).*(reached|exceeded)`.

`parseResetTime` handles "5:00 PM UTC", "17:00 UTC", "in 30 minutes". Defaults to 30 min. Adds 60s buffer. Floors at 60s.

### 1.8 Isolated env (sdk-session.ts:367-458)

`HOME = <cwd>/.home` with pre-created `.claude`, `tmp`, `.config`, `.cache`, `.local/share`, `.local/state`, `screenshots`. Copies parent `~/.claude/settings.json` into session home. `CLAUDE_CONFIG_DIR` → parent `~/.claude`. Sets `TMPDIR`, `XDG_*`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=30000`. Passthrough: `GITHUB_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `SUPABASE_ACCESS_TOKEN`. (Drop `SENTRY_ACCESS_TOKEN`, `ZAI_API_KEY`.)

## 2. `claude-stream.ts` translation

### 2.1 Input shapes (stream-json from claude CLI)

Wrapper:
```ts
{
  type: "stream_event" | "assistant" | "user" | "result" | <other>,
  subtype?, parent_tool_use_id?: string|null,
  event?: { type, index?, content_block?: {type, text?, id?, name?}, delta?: {type, text?, partial_json?} },
  message?: { role, stop_reason?, content: Array<{type, text?, thinking?, signature?, id?, tool_use_id?, name?, input?, content?}> },
  result?: string, is_error?: boolean,
  total_cost_usd?: number, num_turns?: number,
  usage?: { input_tokens?, output_tokens? },
  session_id?: string,
}
```

### 2.2 Translation cases

- **`assistant`** (terminal message): emits one event per `thinking` block, one per valid `tool_use` (last one carries `stopReason`). **Text content blocks in the terminal assistant message are intentionally skipped** — final text streams via deltas.
- **`user`**: extracts `tool_result` blocks; emits `{role:"user", content:[{type:"toolResponse", id, parentToolUseId, toolResult: block.content}]}` per block. (`.input` fallback is vestigial; safe to drop.)
- **`stream_event`**: only `content_block_delta` + `delta.type === "text_delta"` + non-empty `delta.text` → text message. Everything else → null.
- **`result`**: `is_error` → `{type:"error", error: raw.result ?? "Unknown error"}`. Else `{type:"complete", total_tokens, total_cost_usd, num_turns}`.
- Missing tool names → warn + drop (consider emitting a `status` transcript event instead in the new runtime).

### 2.3 Output shape (`GooseStreamEvent`)

```ts
type GooseStreamEvent =
  | { type: "message"; message: GooseMessage }
  | { type: "error"; error: string }
  | { type: "complete"; total_tokens: number|null; total_cost_usd: number|null; num_turns: number|null }
  | { type: "idle" }
  | { type: "quota_exhausted"; resetAt?: number; rawMessage: string }
  | { type: "notification"; extensionId: string; message?: string; progress?: number; total?: number|null }
```

`GooseMessage.content` blocks: `text`, `toolRequest`, `toolResponse`, `thinking`, `systemNotification`, `notification`.

## 3. MCP config (kept four)

Passed as `--mcp-config`, `JSON.stringify({mcpServers: {...}})`. Empty → flag not appended.

**playwright** (gate: `mcp.browserEnabled`):
```json
"playwright": { "command": "playwright-mcp",
  "args": ["--browser","chromium","--headless","--no-sandbox","--isolated","--caps","vision"] }
```
Also set env `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

**github** (gate: `mcp.githubEnabled`, requires `GITHUB_TOKEN`):
```json
"github": { "command": "github-mcp-server", "args": ["stdio"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<GITHUB_TOKEN>" } }
```
Skip if `GITHUB_TOKEN` absent.

**context7** (gate: `mcp.context7Enabled`):
```json
"context7": { "command": "context7-mcp", "args": [] }
```

**supabase** (gate: `mcp.supabaseEnabled`, requires `SUPABASE_ACCESS_TOKEN`):
```json
"supabase": { "command": "npx",
  "args": ["-y","@supabase/mcp-server-supabase@latest","--access-token","<token>",
           ("--project-ref","<ref>")?] }
```

**Drop**: sentry, fly, z-ai web-search-prime. Do not port their args or env vars.

## 4. TranscriptEvent shape

Union (src/transcript/types.ts:109-201, identical to `shared/api-types.ts:345-440`):

1. `user_message` — `{text, images?}`
2. `turn_started` — `{trigger: "user_message"|"agent_continuation"|"command"|"reply_injected"|"resume"}`
3. `turn_completed` — `{totalTokens?, totalCostUsd?, durationMs?, errored?}`
4. `assistant_text` — `{blockId, text, final}`
5. `thinking` — `{blockId, text, final, signature?}`
6. `tool_call` — `{call: ToolCallSummary}`
7. `tool_result` — `{toolUseId, result: ToolResultPayload}`
8. `status` — `{severity, kind, message, data?}`

Base: `{seq, id, sessionId, turn, timestamp}`.

Truncation budget (`TRANSCRIPT_TRUNCATION_BUDGET`): file 32KB, bash 64KB, total event 256KB.

### `seq` assignment

Per-session monotonic. Old: `this.seq++` in `TranscriptBuilder.baseFields()`. New runtime: `INTEGER PRIMARY KEY AUTOINCREMENT` semantics are tricky with composite PK; instead keep an in-memory counter per session seeded on boot with `SELECT COALESCE(MAX(seq), -1) + 1 FROM session_events WHERE session_id = ?`.

Stable `status.kind` codes include: `quota_exhausted`, `session_error`, `tool_call_error`, `quota_sleep`, `reply_injected`, `ci_retry`.

## 5. Legacy paths

### `spawnGoose` (session.ts:396-435)

**Do not port.** Goose is cut.

### legacy `spawnClaude` (session.ts:437-462)

Non-stream-json claude, positional task arg, stdin ignored. Only used when:
- `systemPromptOverride` is passed (bypasses mode map).
- Mode not in `SDK_MODES` — i.e. `ci-fix`.

### CI-fix

`spawnCIFixAgent` (engine.ts:1609-1684). Unique responsibilities:
1. Different system prompt: `DEFAULT_CI_FIX_PROMPT`.
2. Called by `ci-babysitter.ts` with a structured task.
3. One-shot: completes autonomously, no reply injection.

**Folding into stream-json runtime**: add `ci-fix` to the mode map with:
- `systemPrompt = DEFAULT_CI_FIX_PROMPT`
- `model = claude.taskModel` (reasonable default)
- `disallowedTools = []`
- `autoExitOnComplete = true` — kill the process after the first `complete` instead of going idle.

## 6. Proposed `EngineEvent` union (server/events/types.ts)

```ts
export type EngineEvent =
  // Session runtime
  | { kind: "session.spawning"; sessionId: string; mode: string; cwd: string }
  | { kind: "session.started"; sessionId: string; pid: number; claudeSessionId?: string }
  | { kind: "session.stream"; sessionId: string; event: TranscriptEvent }
  | { kind: "session.idle"; sessionId: string }
  | { kind: "session.reply_injected"; sessionId: string; chars: number; imageCount: number }
  | { kind: "session.quota_sleep"; sessionId: string; resetAt: number; retryCount: number; retryMax: number }
  | { kind: "session.resumed"; sessionId: string; retryCount: number }
  | { kind: "session.stalled"; sessionId: string; sinceMs: number }
  | { kind: "session.completed"; sessionId: string; state: "completed" | "errored" | "quota_exhausted" | "stream_stalled"; durationMs: number; totalTokens?: number; totalCostUsd?: number }
  // DAG lifecycle
  | { kind: "dag.node.queued"; dagId: string; nodeId: string; dependsOn: string[] }
  | { kind: "dag.node.started"; dagId: string; nodeId: string; sessionId: string }
  | { kind: "dag.node.completed"; dagId: string; nodeId: string; sessionId: string; state: "completed" | "errored" | "quota_exhausted" }
  | { kind: "dag.completed"; dagId: string; succeeded: string[]; failed: string[] }
```

**Guarantee**: every spawn emits exactly one `session.completed` via try/finally. No zombies.

## UNCLEAR items for Phase 2 to verify
### Resume smoke test result (2026-04-21T19:52:07.680Z)

- Compatible: true
- Detail: COMPATIBLE — exit 1 (expected: fake UUID fails with semantic error, not flag conflict), stdout len=868 (NDJSON error result emitted), stderr len=227 ("not a UUID" message). Flags compose; real session UUIDs will work.
- Conclusion: `--resume` composes with `--input-format stream-json`; use natively in runtime. No replay-as-prefix fallback needed.


- `claude --resume <id>` composability with `--input-format stream-json`. If it doesn't compose, fall back to transcript-replay-as-prefix-message using `session_events`.
- `context7-mcp` binary availability in the Bun Docker image.
- Exact current name of the "Stream idle timeout" error string (user phrasing; closest in source is `"SDK session inactivity timeout"`).
- Whether `block.input` fallback in tool_result translation is needed (likely vestigial).
