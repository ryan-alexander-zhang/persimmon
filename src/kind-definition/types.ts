// KindDefinition spec (01-kind-definition.md, schemas/kind-definition.yaml).
import type { Resource } from '../resource/types.js'

export type JsonSchema = Record<string, unknown>

export interface KindVersion {
  name: string
  schema: JsonSchema
  statusSchema?: JsonSchema
}

export interface StepContract {
  inputsPath: string
  outputsPath: string
  runKind: { group: string; kind: string }
  phasePath: string
  outputsValuePath: string
  errorPath: string
}

export interface Subscription {
  eventType: string
  filter?: string
}

export interface KindDefinitionSpec {
  group: string
  names: { kind: string; plural: string }
  scope: 'Namespaced' | 'Global' | 'Any'
  versions: KindVersion[]
  mutability: 'SpecMutable' | 'Immutable'
  revisioned?: boolean
  snapshot: 'Definition' | 'None'
  snapshotOnCreate?: boolean
  handlerRef?: { name: string }
  terminal?: { path: string; values: string[] }
  stepContract?: StepContract
  subscriptions?: Subscription[]
}

export type KindDefinition = Resource<KindDefinitionSpec>
