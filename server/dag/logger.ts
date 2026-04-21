export interface Logger {
  debug(obj: unknown, msg?: string): void
  debug(msg: string): void
  info(obj: unknown, msg?: string): void
  info(msg: string): void
  warn(obj: unknown, msg?: string): void
  warn(msg: string): void
  error(obj: unknown, msg?: string): void
  error(msg: string): void
}

function makeLogger(): Logger {
  const noop = () => {}
  return { debug: noop, info: noop, warn: noop, error: noop }
}

export const loggers = {
  dagExtract: makeLogger(),
} as const
