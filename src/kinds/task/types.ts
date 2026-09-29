// Task and TaskRun (12-task.md, 17-runs.md, schemas/task.yaml, schemas/runs.yaml).
import type { ReconcileError } from '../../reconcile/types.js'
import type { Actor, ExternalResourceRef, LocalDefinitionRef, ObjectRef, Resource, RevisionRef } from '../../resource/types.js'
import type { InputSpec, OutputSpec, RuntimeValues } from '../ports/types.js'

export type ContextEntry =
  | { kind: 'file'; input: string; path: string }
  | { kind: 'artifact'; input: string }
  | { kind: 'prompt'; ref: LocalDefinitionRef }
  | { kind: 'skill'; ref: LocalDefinitionRef }

export type ResolvedContextEntry =
  | { kind: 'file'; ref: ExternalResourceRef; path: string }
  | { kind: 'artifact'; ref: RevisionRef }
  | { kind: 'prompt'; name: string; mediaType: string; content: string; digest: string }
  | { kind: 'skill'; name: string; source: ExternalResourceRef; digest: string; format: string }

export interface RetryPolicy {
  maxAttempts: number
  backoff: { strategy: 'fixed' | 'linear' | 'exponential'; initial: string; max: string; jitter?: 'none' | 'full' }
  retryOn?: string[]
  abortOn?: string[]
}

export type SideEffects = 'none' | 'idempotent' | 'nonIdempotent'

export interface TaskSpec {
  inputs?: Record<string, InputSpec>
  outputs?: Record<string, OutputSpec>
  executorRef: LocalDefinitionRef
  action: { instructions: string; context?: ContextEntry[]; parameters?: Record<string, unknown>; workspace?: { path: string } | { input: string } }
  timeout: string
  retryPolicy?: RetryPolicy
  sideEffects: SideEffects
}

export type Task = Resource<TaskSpec>

export interface ExecutorSpec {
  type: 'agent' | 'script' | 'tool' | 'human'
  adapter: string
  configuration?: Record<string, unknown>
  security?: { networkAccess?: 'deny' | 'allowlist'; allowedHosts?: string[]; credentialBindings?: string[] }
}

export interface TaskResult {
  protocol: 'persimmon.result/v1'
  outputs: RuntimeValues
  summary?: string
}

export interface Address {
  workflowRunRef: ObjectRef
  stepRef: string
  iterationPath: string
  logicalExecutionId: string
}

export interface Attempt {
  index: number
  state: 'running' | 'succeeded' | 'failed' | 'unknown'
  idempotencyKey: string
  startedAt: string
  finishedAt?: string
  error?: ReconcileError
  acknowledged?: boolean
}

export type Phase = 'Pending' | 'Running' | 'Waiting' | 'Succeeded' | 'Failed' | 'Cancelled'

export interface TaskRunSpec {
  taskRef: LocalDefinitionRef
  address: Address
  deadline: string
  inputs: RuntimeValues
}

export interface TaskRunStatus {
  phase: Phase
  attempts: Attempt[]
  context?: ResolvedContextEntry[] // what the Adapter saw, recorded at the first attempt (12-task.md)
  outputs?: RuntimeValues
  error?: ReconcileError
  actor?: Actor
  waitingReason?: string
}

export type TaskRun = Resource<TaskRunSpec, TaskRunStatus>

export const terminal: ReadonlySet<string> = new Set(['Succeeded', 'Failed', 'Cancelled'])
/** Never retried, whatever the policy says (12-task.md). */
export const neverRetried: ReadonlySet<string> = new Set(['permission_denied', 'invalid_input', 'schema_violation'])
