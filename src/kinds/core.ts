// Shipped KindDefinitions and Handler resources for the core kinds (01-kind-definition.md, 02-handler.md).
// Spec schemas point at docs/design/schemas pointers; the KindRegistry resolves them.
import type { KindDefinition, KindDefinitionSpec, StepContract } from '../kind-definition/types.js'
import type { Handler } from '../handler/types.js'

const runTerminal = { path: 'status.phase', values: ['Succeeded', 'Failed', 'Cancelled'] }
const contract = (kind: string): StepContract => ({ inputsPath: 'spec.inputs', outputsPath: 'spec.outputs', runKind: { group: 'persimmon.ai', kind }, phasePath: 'status.phase', outputsValuePath: 'status.outputs', errorPath: 'status.error' })
const ref = (pointer: string) => ({ $ref: pointer })

function kind(kindName: string, plural: string, spec: Omit<KindDefinitionSpec, 'group' | 'names'>): KindDefinition {
  return { apiVersion: 'persimmon.ai/v1', kind: 'KindDefinition', metadata: { name: `${plural}.persimmon.ai` }, spec: { group: 'persimmon.ai', names: { kind: kindName, plural }, ...spec } }
}
const definition = (kindName: string, plural: string, schema: string, extra: Partial<KindDefinitionSpec> = {}): KindDefinition =>
  kind(kindName, plural, { scope: 'Any', versions: [{ name: 'v1', schema: ref(schema) }], mutability: 'SpecMutable', snapshot: 'Definition', ...extra })
const run = (kindName: string, plural: string, handler: string, extra: Partial<KindDefinitionSpec> = {}): KindDefinition =>
  kind(kindName, plural, {
    scope: 'Namespaced',
    versions: [{ name: 'v1', schema: ref(`runs.yaml#/$defs/${kindName}/properties/spec`), statusSchema: ref(`runs.yaml#/$defs/${kindName}/properties/status`) }],
    mutability: 'Immutable',
    snapshot: 'None',
    handlerRef: { name: handler },
    terminal: runTerminal,
    ...extra,
  })

/** Layer 0 kinds the engine registers at start, without handlerRef. */
export const frameworkKinds: KindDefinition[] = [
  kind('KindDefinition', 'kinddefinitions', { scope: 'Global', versions: [{ name: 'v1', schema: ref('kind-definition.yaml#/$defs/Spec') }], mutability: 'SpecMutable', snapshot: 'None' }),
  kind('Handler', 'handlers', { scope: 'Global', versions: [{ name: 'v1', schema: ref('handler.yaml#/$defs/Spec') }], mutability: 'SpecMutable', snapshot: 'None' }),
  kind('Adapter', 'adapters', { scope: 'Global', versions: [{ name: 'v1', schema: ref('adapter.yaml#/$defs/Spec'), statusSchema: ref('adapter.yaml#/$defs/Status') }], mutability: 'SpecMutable', snapshot: 'None' }),
]

/** Layer 1 kinds (10–18) and their Handlers. */
export const coreKinds: KindDefinition[] = [
  definition('Workflow', 'workflows', 'workflow.yaml#/$defs/Spec', { handlerRef: { name: 'workflow' }, stepContract: contract('WorkflowRun') }),
  definition('Task', 'tasks', 'task.yaml#/$defs/Spec', { handlerRef: { name: 'task' }, stepContract: contract('TaskRun') }),
  definition('Executor', 'executors', 'executor.yaml#/$defs/Spec', { handlerRef: { name: 'executor' } }),
  definition('Gate', 'gates', 'gate.yaml#/$defs/Gate/properties/spec', { handlerRef: { name: 'gate' }, stepContract: contract('GateRun') }),
  definition('Validator', 'validators', 'gate.yaml#/$defs/Validator/properties/spec', { handlerRef: { name: 'validator' } }),
  definition('Pipeline', 'pipelines', 'composition.yaml#/$defs/Pipeline', { handlerRef: { name: 'composition' }, stepContract: contract('WorkflowRun'), expansion: { kind: 'Workflow' } }),
  definition('ReviewLoop', 'reviewloops', 'composition.yaml#/$defs/ReviewLoop', { handlerRef: { name: 'composition' }, stepContract: contract('WorkflowRun'), expansion: { kind: 'Workflow' } }),
  definition('Approval', 'approvals', 'composition.yaml#/$defs/Approval', { handlerRef: { name: 'composition' }, stepContract: contract('GateRun'), expansion: { kind: 'Gate' } }),
  definition('Prompt', 'prompts', 'prompt-skill.yaml#/$defs/Prompt/properties/spec'),
  definition('Skill', 'skills', 'prompt-skill.yaml#/$defs/Skill/properties/spec'),
  definition('RelationType', 'relationtypes', 'relation.yaml#/$defs/RelationType/properties/spec', { mutability: 'Immutable' }),
  kind('Relation', 'relations', { scope: 'Namespaced', versions: [{ name: 'v1', schema: ref('relation.yaml#/$defs/Relation/properties/spec') }], mutability: 'Immutable', snapshot: 'None' }),
  kind('Trigger', 'triggers', {
    scope: 'Namespaced',
    versions: [{ name: 'v1', schema: ref('trigger.yaml#/$defs/Spec'), statusSchema: ref('trigger.yaml#/$defs/Status') }],
    mutability: 'SpecMutable',
    snapshot: 'None',
    handlerRef: { name: 'trigger' },
    subscriptions: [{ eventType: 'artifact.published' }, { eventType: 'resource.finished', filter: 'event.subject.kind == "WorkflowRun"' }],
  }),
  run('WorkflowRun', 'workflowruns', 'workflow', { snapshotOnCreate: true }),
  run('TaskRun', 'taskruns', 'task'),
  run('GateRun', 'gateruns', 'gate'),
  run('ValidationRun', 'validationruns', 'validator'),
]

const handler = (name: string, kinds: string[]): Handler => ({
  apiVersion: 'persimmon.ai/v1',
  kind: 'Handler',
  metadata: { name },
  spec: { kinds: kinds.map((k) => ({ group: 'persimmon.ai', kind: k, versions: ['v1'] })), implementation: { builtin: name } },
})

export const coreHandlers: Handler[] = [
  handler('workflow', ['Workflow', 'WorkflowRun']),
  handler('task', ['Task', 'TaskRun']),
  handler('executor', ['Executor']),
  handler('gate', ['Gate', 'GateRun']),
  handler('validator', ['Validator', 'ValidationRun']),
  handler('trigger', ['Trigger']),
  handler('composition', ['Pipeline', 'Approval', 'ReviewLoop']),
]
