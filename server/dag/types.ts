export type { ProviderProfile } from '../../shared/api-types'

export interface TopicMessage {
  role: "user" | "assistant"
  text: string
  images?: string[]
}

export abstract class MinionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class DagCycleError extends MinionError {
  readonly cycleNodes?: string[]

  constructor(cycleNodes?: string[]) {
    let message = "DAG contains a cycle"
    if (cycleNodes && cycleNodes.length > 0) {
      message += `: ${cycleNodes.join(" → ")}`
    }
    super(message)
    this.cycleNodes = cycleNodes
  }
}

export class DagSelfDependencyError extends MinionError {
  readonly nodeId: string

  constructor(nodeId: string) {
    super(`Node "${nodeId}" depends on itself`)
    this.nodeId = nodeId
  }
}

export class UnknownNodeError extends MinionError {
  readonly nodeId: string
  readonly unknownDependency: string
  readonly availableNodes: string[]

  constructor(nodeId: string, unknownDependency: string, availableNodes: string[] = []) {
    let message = `Node "${nodeId}" depends on unknown node "${unknownDependency}"`
    if (availableNodes.length > 0) {
      message += `. Available: ${availableNodes.map((n) => `"${n}"`).join(", ")}`
    }
    super(message)
    this.nodeId = nodeId
    this.unknownDependency = unknownDependency
    this.availableNodes = availableNodes
  }
}
