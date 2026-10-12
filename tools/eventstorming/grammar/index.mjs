// The event storming DSL v4.0 grammar: element types, level gating, edge rules, context
// relationship types, and `check` — the rules the old tool split between its validator
// (errors) and its editor health check (model smells). One copy, no dependencies, so
// `adapters/eventstorming/` and the editor can both import it without a build.

export const DSL_VERSION = '4.0'

export const elements = [
  'domainEvent',
  'command',
  'actor',
  'constraint',
  'aggregate',
  'policy',
  'readModel',
  'externalSystem',
  'hotspot',
  'opportunity',
]

export const levels = {
  'big-picture': ['actor', 'externalSystem', 'domainEvent', 'hotspot', 'opportunity'],
  process: ['actor', 'externalSystem', 'command', 'domainEvent', 'policy', 'readModel', 'hotspot', 'opportunity'],
  design: elements,
}

export const levelRank = { 'big-picture': 0, process: 1, design: 2 }

/** `'*'` in sources or targets means any element type. */
export const relations = [
  { relation: 'issues', sources: ['actor', 'externalSystem'], targets: ['command'] },
  { relation: 'produces', sources: ['command'], targets: ['domainEvent'] },
  { relation: 'constrainedBy', sources: ['command'], targets: ['constraint'] },
  { relation: 'handledBy', sources: ['command'], targets: ['aggregate', 'externalSystem'] },
  { relation: 'emits', sources: ['aggregate', 'externalSystem'], targets: ['domainEvent'] },
  { relation: 'triggers', sources: ['domainEvent'], targets: ['policy'] },
  { relation: 'invokes', sources: ['policy'], targets: ['command'] },
  { relation: 'updates', sources: ['domainEvent'], targets: ['readModel'] },
  { relation: 'informs', sources: ['readModel'], targets: ['actor'] },
  { relation: 'annotates', sources: ['hotspot'], targets: ['*'] },
  { relation: 'highlights', sources: ['opportunity'], targets: ['*'] },
]

export const contextRelations = [
  'partnership',
  'sharedKernel',
  'customerSupplier',
  'conformist',
  'acl',
  'openHostService',
  'publishedLanguage',
  'separateWays',
]

/** property key -> the element types allowed to carry it. */
export const propertyTypes = {
  description: elements,
  pivotal: ['domainEvent'],
  temporal: ['domainEvent'],
  state: ['hotspot'],
  kind: ['hotspot'],
  priority: ['hotspot'],
  resolution: ['hotspot'],
  resolvedAt: ['hotspot'],
  condition: ['policy'],
  execution: ['policy'],
  parameters: ['policy'],
  rule: ['constraint'],
  alternativeSet: ['domainEvent', 'command'],
}

const enums = {
  state: ['open', 'resolved'],
  kind: ['conflict', 'question', 'risk'],
  priority: ['low', 'medium', 'high'],
  execution: ['automatic', 'manual'],
}
const classifications = ['core', 'supporting', 'generic']
// An aggregate over these is doing too much.
const aggMaxCommands = 5
const aggMaxEvents = 5
// Forward causal relations a command follows to reach the event it causes.
const causalForward = ['produces', 'handledBy', 'emits']
// Relations a reaction cycle can run around.
const cycleRelations = ['produces', 'emits', 'handledBy', 'triggers', 'invokes']
const severityRank = { error: 0, warning: 1, info: 2 }

const expand = (names) => (names.includes('*') ? elements : names)
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value])

/**
 * Check a DSL v4.0 model. Returns findings ordered errors first, then by code, then by
 * message, so the same model always answers the same list.
 */
export function check(content) {
  const findings = []
  const add = (severity, code, message) => findings.push({ severity, code, message })
  const notAModel = (message) => [{ severity: 'error', code: 'not-a-model', message }]

  if (!isObject(content) || content.version !== DSL_VERSION) {
    return notAModel(`content is not a DSL ${DSL_VERSION} model`)
  }
  const lists = {}
  for (const key of ['contexts', 'contextRelationships', 'nodes', 'edges']) {
    const value = content[key]
    if (value === undefined || value === null) {
      lists[key] = []
    } else if (!Array.isArray(value) || !value.every(isObject)) {
      return notAModel(`${key} must be an array of objects`)
    } else {
      lists[key] = value
    }
  }
  const meta = isObject(content.meta) ? content.meta : {}
  const level = meta.level
  const levelTypes = Object.hasOwn(levels, level) ? levels[level] : null
  if (!levelTypes) add('error', 'bad-enum', `meta.level '${level}' - use ${Object.keys(levels).join('|')}`)

  // contexts
  const contextIds = new Set()
  for (const c of lists.contexts) {
    if (contextIds.has(c.id)) add('error', 'duplicate-id', `context ${c.id}: duplicate id`)
    contextIds.add(c.id)
    if (c.classification != null && !classifications.includes(c.classification)) {
      add('error', 'bad-enum', `context ${c.id}: classification '${c.classification}' - use ${classifications.join('|')}`)
    }
  }

  // context relationships
  const relationshipIds = new Set()
  for (const r of lists.contextRelationships) {
    const rid = r.id ?? '?'
    if (relationshipIds.has(rid)) add('error', 'duplicate-id', `contextRelationship ${rid}: duplicate id`)
    relationshipIds.add(rid)
    for (const side of ['source', 'target']) {
      if (!contextIds.has(r[side])) {
        add('error', 'undeclared-context', `contextRelationship ${rid}: ${side} '${r[side]}' is not a declared context`)
      }
    }
    if (!contextRelations.includes(r.type)) {
      add('error', 'bad-enum', `contextRelationship ${rid}: type '${r.type}' - use one of ${contextRelations.join(', ')}`)
    }
    if (r.source === r.target) {
      add('error', 'self-relationship', `contextRelationship ${rid}: source and target are the same context`)
    }
  }

  // nodes
  const nodes = new Map()
  for (const n of lists.nodes) {
    const nid = n.id
    if (typeof nid !== 'string' || !nid) continue
    if (nodes.has(nid)) add('error', 'duplicate-id', `node ${nid}: duplicate id`)
    if (!elements.includes(n.type)) {
      add('error', 'bad-enum', `node ${nid}: type '${n.type}' - use one of ${elements.join(', ')}`)
      continue
    }
    nodes.set(nid, n)
    if (levelTypes && !levelTypes.includes(n.type)) {
      add('error', 'not-at-level', `node ${nid}: type '${n.type}' is not allowed at level '${level}'`)
    }
    if (n.context != null && !contextIds.has(n.context)) {
      add('error', 'undeclared-context', `node ${nid}: context '${n.context}' is not declared in contexts`)
    }
    if ('order' in n) {
      if (n.type !== 'domainEvent') add('error', 'order-not-on-event', `node ${nid}: order is only allowed on domainEvent`)
    } else if (n.type === 'domainEvent') {
      add('warning', 'event-without-order', `node ${nid}: domainEvent without order - it has no place on the timeline`)
    }
    if (!isObject(n.properties)) continue
    for (const [k, v] of Object.entries(n.properties)) {
      if (!Object.hasOwn(propertyTypes, k)) {
        add('error', 'property-not-on-type', `node ${nid}: unknown property '${k}'`)
        continue
      }
      const allowed = propertyTypes[k]
      if (!allowed.includes(n.type)) {
        add('error', 'property-not-on-type', `node ${nid}: property '${k}' is only allowed on ${[...allowed].sort().join('/')}, not ${n.type}`)
      }
      if (Object.hasOwn(enums, k) && !enums[k].includes(v)) {
        add('error', 'bad-enum', `node ${nid}: ${k} '${v}' - use ${enums[k].join('|')}`)
      }
      if (k === 'parameters' && (!Array.isArray(v) || !v.every((p) => isObject(p) && typeof p.name === 'string' && typeof p.value === 'string'))) {
        add('error', 'bad-parameters', `node ${nid}: each parameter must be {"name": "...", "value": "..."} with string values`)
      }
    }
  }

  // edges
  const edgeIds = new Set()
  const seenPairs = new Set()
  const edges = []
  for (const e of lists.edges) {
    const eid = e.id ?? '?'
    if (edgeIds.has(eid)) add('error', 'duplicate-id', `edge ${eid}: duplicate id`)
    edgeIds.add(eid)
    const { source, target, relation } = e
    if (!nodes.has(source) || !nodes.has(target)) {
      add('error', 'edge-endpoint-missing', `edge ${eid}: '${nodes.has(source) ? target : source}' is not a node id`)
      continue
    }
    const st = nodes.get(source).type
    const tt = nodes.get(target).type
    const legal = relations
      .filter((r) => expand(r.sources).includes(st) && expand(r.targets).includes(tt))
      .map((r) => r.relation)
    if (!relations.some((r) => r.relation === relation)) {
      add('error', 'wrong-relation', `edge ${eid}: relation '${relation}' does not exist`)
    } else if (legal.length === 0) {
      add('error', 'illegal-connection', `edge ${eid}: ${st} -> ${tt} is not a legal connection`)
    } else if (!legal.includes(relation)) {
      add('error', 'wrong-relation', `edge ${eid}: ${st} -> ${tt} must be '${legal[0]}', not '${relation}'`)
    }
    const key = JSON.stringify([source, target, relation])
    if (seenPairs.has(key)) add('warning', 'duplicate-edge', `edge ${eid}: duplicate of an existing ${relation} edge`)
    seenPairs.add(key)
    edges.push([source, target, relation])
  }

  health(nodes, edges, level, contextIds, add)

  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  )
  return findings
}

/** The model smells: nothing here is illegal, it is only probably wrong. */
function health(nodes, edges, level, contextIds, add) {
  const outgoing = new Map()
  const incoming = new Map()
  for (const [s, t, rel] of edges) {
    push(outgoing, s, [t, rel])
    push(incoming, t, [s, rel])
  }
  const out = (id) => outgoing.get(id) ?? []
  const inc = (id) => incoming.get(id) ?? []
  const props = (n) => (isObject(n.properties) ? n.properties : {})

  const used = new Set([...nodes.values()].map((n) => n.context))
  for (const cid of contextIds) {
    if (!used.has(cid)) add('warning', 'empty-context', `context ${cid}: declared but empty`)
  }

  const events = [...nodes.values()].filter((n) => n.type === 'domainEvent')
  if (events.length > 0 && !events.some((n) => props(n).pivotal)) {
    add('warning', 'no-pivotal-event', 'no pivotal events - mark the few that change the state of the business')
  }

  for (const [nid, n] of nodes) {
    if (n.type === 'domainEvent' && level !== 'big-picture') {
      // A temporal event is raised by time passing and needs no producer.
      if (!props(n).temporal && !inc(nid).some(([, r]) => r === 'produces' || r === 'emits')) {
        add('warning', 'orphan-event', `node ${nid}: orphan event '${n.label}' - nothing produces or emits it`)
      }
    }
    if (n.type === 'command') {
      if (!reachesEvent(nid, outgoing, nodes)) {
        add('warning', 'dangling-command', `node ${nid}: dangling command '${n.label}' - it produces no domain event`)
      }
      if (!inc(nid).some(([, r]) => r === 'issues' || r === 'invokes')) {
        add('warning', 'unissued-command', `node ${nid}: command '${n.label}' - nothing issues it and no policy invokes it`)
      }
    }
    if (n.type === 'aggregate') {
      const handled = inc(nid).filter(([, r]) => r === 'handledBy').length
      const emitted = out(nid).filter(([, r]) => r === 'emits').length
      if (handled > aggMaxCommands || emitted > aggMaxEvents) {
        add('warning', 'overloaded-aggregate', `node ${nid}: overloaded aggregate '${n.label}' - ${handled} command(s), ${emitted} event(s) - split it?`)
      }
    }
    if (n.type === 'policy') {
      if (!inc(nid).some(([, r]) => r === 'triggers')) {
        add('warning', 'untriggered-policy', `node ${nid}: policy '${n.label}' - no domain event triggers it`)
      }
      if (!out(nid).some(([, r]) => r === 'invokes')) {
        add('warning', 'idle-policy', `node ${nid}: policy '${n.label}' - it invokes no command`)
      }
      if (!('execution' in props(n))) {
        add('warning', 'policy-without-execution', `node ${nid}: policy '${n.label}' - no execution - automatic or manual?`)
      }
    }
  }

  const sets = new Map()
  for (const n of nodes.values()) {
    const key = props(n).alternativeSet
    if (key) push(sets, key, n.label)
  }
  for (const [key, members] of sets) {
    if (members.length < 2) {
      add('warning', 'lone-alternative', `alternative set '${key}': only '${members[0]}' is in it - nothing happens instead of itself`)
    }
  }

  const open = [...nodes.values()].filter((n) => n.type === 'hotspot' && props(n).state !== 'resolved')
  if (open.length > 0) {
    add('info', 'open-hotspots', `${open.length} open hotspot(s): ${open.map((n) => n.label).join('; ')}`)
  }

  // A hotspot ticked off with nothing written down loses why it was closed.
  const blank = [...nodes.values()].filter(
    (n) => n.type === 'hotspot' && props(n).state === 'resolved' && !(props(n).resolution ?? '').trim(),
  )
  if (blank.length > 0) {
    add('warning', 'unrecorded-resolution', `${blank.length} resolved hotspot(s) with no resolution: ${blank.map((n) => n.label).join('; ')}`)
  }

  for (const cycle of policyCycles(nodes, edges)) {
    add('warning', 'reaction-cycle', `reaction cycle: ${cycle.map((id) => nodes.get(id).label).join(' -> ')}`)
  }
}

function reachesEvent(start, outgoing, nodes) {
  const seen = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.pop()
    for (const [t, r] of outgoing.get(cur) ?? []) {
      if (!causalForward.includes(r)) continue
      if (nodes.get(t).type === 'domainEvent') return true
      if (!seen.has(t)) {
        seen.add(t)
        queue.push(t)
      }
    }
  }
  return false
}

/** Directed cycles in the causal flow that run through a policy. */
function policyCycles(nodes, edges) {
  const adjacency = new Map()
  for (const [s, t, r] of edges) if (cycleRelations.includes(r)) push(adjacency, s, t)
  const color = new Map()
  const stack = []
  const found = []
  const seenKeys = new Set()
  const visit = (u) => {
    color.set(u, 1)
    stack.push(u)
    for (const v of adjacency.get(u) ?? []) {
      if (!color.has(v)) visit(v)
      else if (color.get(v) === 1 && stack.includes(v)) {
        const cycle = stack.slice(stack.indexOf(v))
        const key = [...cycle].sort().join(',')
        if (!seenKeys.has(key) && cycle.some((id) => nodes.get(id).type === 'policy')) {
          seenKeys.add(key)
          found.push(cycle)
        }
      }
    }
    stack.pop()
    color.set(u, 2)
  }
  for (const nid of nodes.keys()) if (!color.has(nid)) visit(nid)
  return found
}
