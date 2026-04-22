import type {
  DagScheduler,
  LoopScheduler,
  QualityGates,
  QualityReport,
  DigestBuilder,
  CIBabysitter,
  ProfileStore,
  ReplyQueue,
  ReplyQueueFactory,
  MinionConfig,
} from './types'
import type { SessionRegistry } from '../session/registry'
import { createRealCIBabysitter as _createRealCIBabysitter } from '../ci/babysitter'
import { createRealQualityGates as _createRealQualityGates } from '../ci/quality-gates'
import type { Database } from 'bun:sqlite'

export function createNoopDagScheduler(): DagScheduler {
  return {
    async onSessionCompleted(): Promise<void> {},
    async start(): Promise<void> {},
  }
}

export function createNoopLoopScheduler(): LoopScheduler {
  return {
    async recordOutcome(): Promise<void> {},
  }
}

export function createNoopQualityGates(): QualityGates {
  return {
    async run(): Promise<QualityReport> {
      return { allPassed: true, results: [] }
    },
  }
}

export function createNoopDigestBuilder(): DigestBuilder {
  return {
    async build(): Promise<string> {
      return ''
    },
  }
}

export function createNoopCIBabysitter(): CIBabysitter {
  return {
    async babysitPR(): Promise<void> {},
    async queueDeferredBabysit(): Promise<void> {},
    async babysitDagChildCI(): Promise<void> {},
  }
}

export function createNoopProfileStore(): ProfileStore {
  return {
    get(): Record<string, unknown> | undefined {
      return undefined
    },
  }
}

export function createNoopReplyQueue(): ReplyQueue {
  return {
    async pending(): Promise<string[]> {
      return []
    },
    async drain(): Promise<string[]> {
      return []
    },
  }
}

export function createNoopReplyQueueFactory(): ReplyQueueFactory {
  return {
    forSession(): ReplyQueue {
      return createNoopReplyQueue()
    },
  }
}

export function createDefaultConfig(): MinionConfig {
  return {
    quotaRetryMax: parseInt(process.env['QUOTA_RETRY_MAX'] ?? '3', 10),
  }
}

export function createRealCIBabysitter(registry: SessionRegistry, db: Database): CIBabysitter {
  return _createRealCIBabysitter({ registry, db })
}

export function createRealQualityGates(): QualityGates {
  return _createRealQualityGates()
}
