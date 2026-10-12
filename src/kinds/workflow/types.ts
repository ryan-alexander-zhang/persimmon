// Workflow and WorkflowRun (11-workflow.md, 17-runs.md).
import type { ReconcileError } from '../../reconcile/types.js'
import type { Actor, LocalDefinitionRef, ObjectRef, Resource } from '../../resource/types.js'
import type { Bindings, InputSpec, OutputSpec, RuntimeValues } from '../ports/types.js'

export type Outcome = 'Succeeded' | 'Failed'

export interface RepeatPolicy {
  state: Record<string, InputSpec>
  initial: Bindings
  next: Bindings
  until: string
  maxIterations: number
}

export interface Step {
  id: string
  uses: LocalDefinitionRef
  inputs?: Bindings
  timeout: string
  repeat?: RepeatPolicy
}

export type Target = { stepRef: string; when?: string } | { terminal: Outcome; reason?: string; when?: string }

export interface Transition {
  id: string
  from: { stepRef: string; outcomes: Outcome[] }[]
  join?: { strategy: 'all' | 'any' | 'quorum'; count?: number }
  to: Target[]
  dispatch?: 'all' | 'first'
  noMatch?: 'fail' | 'skip'
}

export interface WorkflowSpec {
  inputs?: Record<string, InputSpec>
  outputs?: Record<string, OutputSpec>
  outputBindings?: Bindings
  entry: string[]
  steps: Step[]
  transitions: Transition[]
  timeout: string
}

export type Workflow = Resource<WorkflowSpec>

export type StepPhase = 'Pending' | 'Running' | 'Waiting' | 'Succeeded' | 'Failed' | 'Cancelled' | 'Skipped'
export type Phase = 'Pending' | 'Running' | 'Waiting' | 'Succeeded' | 'Failed' | 'Cancelled'

export type Origin =
  | { kind: 'manual'; actor?: Actor }
  | { kind: 'trigger'; triggerRef: ObjectRef; eventId: string; causationRef?: ObjectRef }
  | { kind: 'parent' }

export interface WorkflowRunSpec {
  workflowRef: LocalDefinitionRef
  inputs: RuntimeValues
  /** Absent: the Workflow's `spec.timeout` (17-runs.md). */
  timeout?: string
  origin: Origin
  parent?: { workflowRunRef: ObjectRef; stepRef: string; iterationPath: string }
}

export interface StepStatus {
  phase: StepPhase
  runRef?: ObjectRef
  iteration?: number
  /** `repeat` state the running iteration was started with, so `next` can read it (11-workflow.md). */
  state?: RuntimeValues
  deadline?: string // the step's effective deadline, set at first start and shared by every repeat iteration (11-workflow.md)
  error?: ReconcileError
}

export interface WorkflowRunStatus {
  phase: Phase
  steps: Record<string, StepStatus>
  outputs?: RuntimeValues
  error?: ReconcileError
  reason?: string
  waitingReason?: string
}

export type WorkflowRun = Resource<WorkflowRunSpec, WorkflowRunStatus>

/** Step contract of a kind a Step may use (01-kind-definition.md). */
export interface StepContract {
  inputsPath: string
  outputsPath: string
  runKind: { group: string; kind: string }
  phasePath: string
  outputsValuePath: string
  errorPath: string
}
