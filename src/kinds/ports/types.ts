// Ports and bindings (10-ports.md, schemas/ports.yaml).
import type { JsonSchema } from '../../kind-definition/types.js'
import type { ExternalResourceRef, RevisionRef } from '../../resource/types.js'

export type PortType =
  | { kind: 'value'; schema?: JsonSchema | { $ref: string } }
  | { kind: 'artifact'; artifactKind: { apiVersion: string; kind: string } }
  | { kind: 'artifacts'; artifactKind: { apiVersion: string; kind: string } }
  | { kind: 'externalResource'; provider: string; type: string }

export type RuntimeValue =
  | { kind: 'value'; value: unknown }
  | { kind: 'artifact'; ref: RevisionRef }
  | { kind: 'artifacts'; refs: RevisionRef[] }
  | { kind: 'externalResource'; ref: ExternalResourceRef }

export interface InputSpec {
  type: PortType
  required?: boolean
  default?: RuntimeValue
  description?: string
}

export interface OutputSpec {
  type: PortType
  description?: string
}

export interface Ports {
  inputs?: Record<string, InputSpec>
  outputs?: Record<string, OutputSpec>
}

export type Binding = { onMissing?: 'omit' } & (
  | { literal: unknown }
  | { fromInput: string }
  | { fromStep: { stepRef: string; output: string } }
  | { fromState: string }
  | { fromIterationOutput: string }
  | { expression: string }
  | { fromEvent: string }
)

export type Bindings = Record<string, Binding>
export type RuntimeValues = Record<string, RuntimeValue>
