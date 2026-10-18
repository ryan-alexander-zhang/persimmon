// Gate, Validator, GateRun, ValidationRun (14-gate.md, 17-runs.md).
import type { ReconcileError } from '../../reconcile/types.js'
import type { LocalDefinitionRef, ObjectRef, Resource } from '../../resource/types.js'
import type { Address, Phase } from '../task/types.js'
import type { Bindings, InputSpec, OutputSpec, RuntimeValues } from '../ports/types.js'

export interface GateSpec {
  inputs?: Record<string, InputSpec>
  outputs: Record<string, OutputSpec>
  validators: { name: string; ref: LocalDefinitionRef; inputs?: Bindings; after?: string[] }[]
  policy?: { strategy: 'all' | 'any' | 'quorum'; count?: number }
  timeout: string
}
export type Gate = Resource<GateSpec>

export type Evaluator =
  | { type: 'cel'; expression: string }
  | { type: 'task'; taskRef: LocalDefinitionRef; resultOutput: string }
  | { type: 'adapter'; adapter: string; configuration?: Record<string, unknown> }

export interface ValidatorSpec {
  inputs?: Record<string, InputSpec>
  evaluator: Evaluator
  timeout: string
}
export type Validator = Resource<ValidatorSpec>

export interface Finding {
  severity: 'error' | 'warning' | 'info'
  code?: string
  message: string
}
export interface ValidationResult {
  passed: boolean
  findings: Finding[]
  evidence: unknown[]
  score?: number
}
export interface GateResult {
  passed: boolean
  results: Record<string, ValidationResult>
}

export interface GateRunSpec {
  gateRef: LocalDefinitionRef
  address: Address
  deadline: string
  inputs: RuntimeValues
}
export interface GateRunStatus {
  phase: Phase
  validationRuns: Record<string, ObjectRef>
  outputs?: { result: { kind: 'value'; value: GateResult } }
  error?: ReconcileError
  waitingReason?: string
}
export type GateRun = Resource<GateRunSpec, GateRunStatus>

export interface ValidationRunSpec {
  validatorRef: LocalDefinitionRef
  gateRunRef: ObjectRef
  name: string
  address: Address
  deadline: string
  inputs: RuntimeValues
}
export interface ValidationRunStatus {
  phase: Phase
  result?: ValidationResult
  error?: ReconcileError
  taskRunRef?: ObjectRef
  waitingReason?: string
}
export type ValidationRun = Resource<ValidationRunSpec, ValidationRunStatus>
