export type LogLevel = "debug" | "info" | "warn" | "error" | "silent"

export type LogFields = Record<string, unknown>

export interface LogEntry {
  level: Exclude<LogLevel, "silent">
  component: string
  msg: string
  fields: LogFields
  timestamp: number
}

export type LogSink = (entry: LogEntry) => void

export interface Logger {
  debug(obj: LogFields, msg?: string): void
  debug(msg: string): void
  info(obj: LogFields, msg?: string): void
  info(msg: string): void
  warn(obj: LogFields, msg?: string): void
  warn(msg: string): void
  error(obj: LogFields, msg?: string): void
  error(msg: string): void
  child(fields: LogFields): Logger
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

function envLevel(): LogLevel {
  const env = typeof process !== "undefined" ? process.env : undefined
  const raw = env?.["LOG_LEVEL"]?.toLowerCase()
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error" || raw === "silent") {
    return raw
  }
  if (env?.["NODE_ENV"] === "test") return "silent"
  return "info"
}

let activeLevel: LogLevel = envLevel()
let activeSink: LogSink = defaultSink

export function setLogLevel(level: LogLevel): void {
  activeLevel = level
}

export function getLogLevel(): LogLevel {
  return activeLevel
}

export function setLogSink(sink: LogSink): void {
  activeSink = sink
}

export function resetLogSink(): void {
  activeSink = defaultSink
}

function defaultSink(entry: LogEntry): void {
  const payload: Record<string, unknown> = {
    t: new Date(entry.timestamp).toISOString(),
    level: entry.level,
    component: entry.component,
    msg: entry.msg,
    ...entry.fields,
  }
  const line = JSON.stringify(payload, replaceErrors)
  if (entry.level === "error" || entry.level === "warn") {
    process.stderr.write(line + "\n")
  } else {
    process.stdout.write(line + "\n")
  }
}

function replaceErrors(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  return value
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[activeLevel]
}

function emit(level: Exclude<LogLevel, "silent">, component: string, bindings: LogFields, a: LogFields | string, b?: string): void {
  if (!shouldLog(level)) return
  let msg: string
  let fields: LogFields
  if (typeof a === "string") {
    msg = a
    fields = bindings
  } else {
    msg = b ?? ""
    fields = { ...bindings, ...a }
  }
  activeSink({ level, component, msg, fields, timestamp: Date.now() })
}

function makeLogger(component: string, bindings: LogFields): Logger {
  return {
    debug(a: LogFields | string, b?: string) {
      emit("debug", component, bindings, a as LogFields | string, b)
    },
    info(a: LogFields | string, b?: string) {
      emit("info", component, bindings, a as LogFields | string, b)
    },
    warn(a: LogFields | string, b?: string) {
      emit("warn", component, bindings, a as LogFields | string, b)
    },
    error(a: LogFields | string, b?: string) {
      emit("error", component, bindings, a as LogFields | string, b)
    },
    child(fields: LogFields): Logger {
      return makeLogger(component, { ...bindings, ...fields })
    },
  }
}

export function createLogger(component: string, bindings: LogFields = {}): Logger {
  return makeLogger(component, bindings)
}

function makeNoopLogger(): Logger {
  const noop = () => {}
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  }
  return logger
}

export const loggers = {
  dagExtract: makeNoopLogger(),
} as const
