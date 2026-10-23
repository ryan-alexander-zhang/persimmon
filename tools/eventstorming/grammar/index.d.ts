// Types for the event storming DSL v4.2 grammar module (tools/eventstorming/grammar/index.mjs),
// declared the way src/adapters.d.ts types adapters/lib/skills.mjs: a wildcard ambient module,
// so a relative import of the .mjs resolves without a build step.
declare module '*/tools/eventstorming/grammar/index.mjs' {
  export type ElementType =
    | 'domainEvent'
    | 'command'
    | 'actor'
    | 'constraint'
    | 'aggregate'
    | 'policy'
    | 'readModel'
    | 'externalSystem'
    | 'hotspot'
    | 'opportunity'
  export type Level = 'big-picture' | 'process' | 'design'
  export type RelationType =
    | 'issues'
    | 'produces'
    | 'constrainedBy'
    | 'handledBy'
    | 'emits'
    | 'triggers'
    | 'invokes'
    | 'updates'
    | 'informs'
    | 'annotates'
    | 'highlights'
  export type ContextRelationType =
    | 'partnership'
    | 'sharedKernel'
    | 'customerSupplier'
    | 'conformist'
    | 'acl'
    | 'openHostService'
    | 'publishedLanguage'
    | 'separateWays'

  export interface NodeProperties {
    description?: string
    pivotal?: boolean
    /** raised by time passing: exempt from the producer checks. */
    temporal?: boolean
    state?: 'open' | 'resolved'
    kind?: 'conflict' | 'question' | 'risk'
    priority?: 'low' | 'medium' | 'high'
    resolution?: string
    resolvedAt?: string
    condition?: string
    execution?: 'automatic' | 'manual'
    parameters?: { name: string; value: string }[]
    rule?: string
    alternativeSet?: string
    /** the Prd id of another product of the project this external system is (DSL 4.2); externalSystem only */
    product?: string
  }

  export interface Context {
    id: string
    name: string
    order: number
    classification?: 'core' | 'supporting' | 'generic'
    bigBallOfMud?: boolean
    /** the Prd subdomain id this context realises (DSL 4.1) */
    subdomain?: string
  }

  export interface ContextRelationship {
    id: string
    source: string
    target: string
    type: ContextRelationType
  }

  export interface ModelNode {
    id: string
    type: ElementType
    label: string
    context?: string
    /** global timeline index; domainEvent only. */
    order?: number
    properties?: NodeProperties
  }

  export interface ModelEdge {
    id: string
    source: string
    target: string
    relation: RelationType
  }

  export interface Model {
    version: string
    meta: { name: string; level: Level }
    contexts?: Context[]
    contextRelationships?: ContextRelationship[]
    nodes?: ModelNode[]
    edges?: ModelEdge[]
  }

  export interface Finding {
    severity: 'error' | 'warning' | 'info'
    code: string
    message: string
  }

  export const DSL_VERSION: '4.2'
  export const elements: ElementType[]
  export const levels: Record<Level, ElementType[]>
  export const levelRank: Record<Level, number>
  /** `'*'` in sources or targets means any element type. */
  export const relations: { relation: RelationType; sources: string[]; targets: string[] }[]
  export const contextRelations: ContextRelationType[]
  /** property key -> the element types allowed to carry it. */
  export const propertyTypes: Record<keyof NodeProperties, ElementType[]>
  /** Findings ordered errors first, then by code, then by message. */
  export function check(content: unknown): Finding[]
  /**
   * A DomainModel against the design-level EventStorming it was derived from, for the storming
   * context `context` (the DomainModel's own `context` is a BoundedContext artifact id, never a
   * fallback). Findings in `check`'s order.
   */
  export function checkDerived(model: unknown, domainModel: unknown, context: string): Finding[]
  /** every Glossary term a label of the context or an entity or value object of the DomainModel: `derived-term-unknown` */
  export function checkGlossary(model: unknown, domainModel: unknown, glossary: unknown, context: string): Finding[]
  /** A storming's contexts against the Prd's `subdomains` (34-subdomains.md). */
  export function checkSubdomains(model: unknown, prd: unknown): Finding[]
  /** A derived BoundedContext against its storming context and the Prd (34-subdomains.md). */
  export function checkBoundedContext(model: unknown, boundedContext: unknown, context: string, prd: unknown): Finding[]
}
