// Composition kinds (21-composition.md, schemas/composition.yaml).
import type { Resource } from '../../resource/types.js'
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
