// Composition kinds (21-composition.md, schemas/composition.yaml).
import type { LocalDefinitionRef, Resource } from '../../resource/types.js'
import type { Bindings, InputSpec, OutputSpec } from '../ports/types.js'
import type { Step } from '../workflow/types.js'

export interface PipelineSpec {
  inputs?: Record<string, InputSpec>
  outputs?: Record<string, OutputSpec>
  outputBindings?: Bindings
  phases: Step[]
  timeout: string
}

export type Pipeline = Resource<PipelineSpec>

export interface ApprovalSpec {
  inputs: Record<string, InputSpec>
  approvers: { name: string; uses: LocalDefinitionRef; inputs?: Record<string, string>; resultOutput?: string }[]
  policy?: { strategy: 'all' | 'any' | 'quorum'; count?: number }
  timeout: string
}

export type Approval = Resource<ApprovalSpec>

export interface LoopStep {
  uses: LocalDefinitionRef
  inputs?: Bindings
  timeout: string
}

export interface ReviewLoopSpec {
  inputs?: Record<string, InputSpec>
  produce: LoopStep
  review: LoopStep
  subject: string
  previous?: string
  feedback?: string
  carry?: Record<string, string>
  maxRounds?: number
  timeout: string
}

export type ReviewLoop = Resource<ReviewLoopSpec>
