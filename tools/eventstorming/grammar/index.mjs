// The event storming DSL v4.1 grammar: element types, level gating, edge rules, context
// relationship types, and `check` — the rules the old tool split between its validator
// (errors) and its editor health check (model smells). One copy, no dependencies, so
// `adapters/eventstorming/` and the editor can both import it without a build.

export const DSL_VERSION = '4.1'
// 4.1 adds `contexts[].subdomain` (34-subdomains.md); a 4.0 model is a 4.1 model without it
const versions = ['4.0', DSL_VERSION]

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
const arr = (v) => (Array.isArray(v) ? v.filter(isObject) : [])
const trim = (v) => (typeof v === 'string' ? v.trim() : v)
const strs = (v) => (Array.isArray(v) ? v.map(trim) : [])
const order = (a, b) =>
  severityRank[a.severity] - severityRank[b.severity] ||
  (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
  (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)

/**
 * Check a DSL v4.1 model (or 4.0). Returns findings ordered errors first, then by code, then by
 * message, so the same model always answers the same list.
 */
export function check(content) {
  const findings = []
  const add = (severity, code, message) => findings.push({ severity, code, message })
  const notAModel = (message) => [{ severity: 'error', code: 'not-a-model', message }]

  if (!isObject(content) || !versions.includes(content.version)) {
    return notAModel(`content is not a DSL ${versions.join(' or ')} model`)
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
    if (c.subdomain != null && (typeof c.subdomain !== 'string' || !c.subdomain)) {
      add('error', 'bad-subdomain', `context ${c.id}: subdomain must be a subdomain id`)
    } else if (c.subdomain != null && content.version === '4.0') {
      add('error', 'bad-subdomain', `context ${c.id}: subdomain is DSL 4.1 - set version 4.1`)
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

  findings.sort(order)
  return findings
}

/**
 * A storming's contexts against the subdomains of the Prd it storms (34-subdomains.md): a context's
 * `subdomain` is one of the Prd's at any level; at design level every context names one, has that
 * subdomain's `type` as its classification, and every subdomain is realised by some context.
 * Findings in `check`'s order and shape.
 */
export function checkSubdomains(model, prd) {
  const findings = []
  const add = (severity, code, message) => findings.push({ severity, code, message })
  const design = isObject(model?.meta) && model.meta.level === 'design'
  const subdomains = new Map(arr(prd?.subdomains).map((d) => [d.id, d]))
  const known = [...subdomains.keys()].join(', ')
  const named = new Set()
  for (const c of arr(model?.contexts)) {
    if (c.subdomain == null) {
      if (design) add('error', 'context-no-subdomain', `context ${c.id}: names no subdomain - one of the Prd's (${known})`)
      continue
    }
    if (typeof c.subdomain !== 'string' || !c.subdomain) continue // check's bad-subdomain
    const d = subdomains.get(c.subdomain)
    if (!d) {
      add('error', 'subdomain-unknown', `context ${c.id}: subdomain '${c.subdomain}' is not one of the Prd's (${known})`)
      continue
    }
    named.add(d.id)
    if (design && c.classification !== d.type) {
      add('error', 'classification-mismatch', `context ${c.id}: classification ${c.classification ?? 'none'} is not ${d.type}, the type of subdomain ${d.id}`)
    }
  }
  if (design) for (const id of subdomains.keys()) if (!named.has(id)) add('error', 'subdomain-unrealised', `subdomain ${id}: no context realises it`)
  return findings.sort(order)
}

const symmetric = ['partnership', 'sharedKernel', 'separateWays']
const kebab = { sharedKernel: 'shared-kernel', customerSupplier: 'customer-supplier', acl: 'anticorruption-layer', openHostService: 'open-host-service', publishedLanguage: 'published-language', separateWays: 'separate-ways' }

/**
 * A derived BoundedContext (34-subdomains.md) against its storming context `context` and the Prd: it
 * copies the context's `subdomain` and `classification`, lists only capabilities of that subdomain
 * (all of them when no other context realises it), and its `relationships` are the storming's
 * `contextRelationships` seen from this context. Findings in `check`'s order and shape.
 */
export function checkBoundedContext(model, boundedContext, context, prd) {
  const findings = []
  const add = (severity, code, message) => findings.push({ severity, code, message })
  const c = arr(model?.contexts).find((x) => x.id === context)
  if (!c) return findings // checkDerived reports the unknown context
  const bc = isObject(boundedContext) ? boundedContext : {}
  if (bc.subdomain !== c.subdomain) add('error', 'derived-subdomain-mismatch', `subdomain ${bc.subdomain ?? 'none'} is not ${c.subdomain ?? 'none'}, the storming context's`)
  if (bc.classification !== c.classification) add('error', 'derived-classification-mismatch', `classification ${bc.classification ?? 'none'} is not ${c.classification ?? 'none'}, the storming context's`)
  const ofSubdomain = arr(prd?.capabilities).filter((cap) => cap.subdomain === c.subdomain).map((cap) => cap.id)
  const listed = Array.isArray(bc.capabilities) ? bc.capabilities : []
  for (const id of listed) if (!ofSubdomain.includes(id)) add('error', 'derived-capability-unknown', `capability ${id} is not a capability of subdomain ${c.subdomain ?? 'none'}`)
  const alone = arr(model?.contexts).filter((x) => x.subdomain === c.subdomain).length === 1
  if (alone) for (const id of ofSubdomain) if (!listed.includes(id)) add('error', 'derived-capability-missing', `capability ${id} of subdomain ${c.subdomain}, which no other context realises, is not listed`)
  // the storming's map seen from this context: upstream as source, downstream as target, peer for a symmetric type
  const key = (r) => `${r.context}|${r.role}|${r.pattern}`
  const want = arr(model?.contextRelationships).filter((r) => r.source === context || r.target === context).map((r) => key({
    context: r.source === context ? r.target : r.source,
    role: symmetric.includes(r.type) ? 'peer' : r.source === context ? 'upstream' : 'downstream',
    pattern: kebab[r.type] ?? r.type,
  }))
  const have = arr(bc.relationships).map(key)
  for (const k of want) if (!have.includes(k)) add('error', 'derived-relationship-mismatch', `relationship ${k.replaceAll('|', ' ')} is in the storming but not in the BoundedContext`)
  for (const k of have) if (!want.includes(k)) add('error', 'derived-relationship-mismatch', `relationship ${k.replaceAll('|', ' ')} is in the BoundedContext but not in the storming`)
  return findings.sort(order)
}

/** A label set the storming holds against the one the domain model holds. */
function diffLabels(add, what, storming, derived, missingCode, extraCode = missingCode) {
  for (const l of storming) if (!derived.includes(l)) add('error', missingCode, `${what} '${l}' is in the storming but not in the domain model`)
  for (const l of derived) if (!storming.includes(l)) add('error', extraCode, `${what} '${l}' is in the domain model but not in the storming`)
}

const parameterKey = (list) => (Array.isArray(list) ? list : []).map((p) => `${trim(p?.name)}=${trim(p?.value)}`).join('\u0000')

/**
 * A DomainModel (26-domain-discovery.md) against the design-level EventStorming it claims as its
 * source: one context's projection must say what that context's storming says. `context` is the
 * storming context id and is required; the DomainModel's own `context` is a BoundedContext artifact
 * id, so it is never a fallback. Findings in `check`'s order and shape.
 */
export function checkDerived(model, domainModel, context) {
  const findings = []
  const add = (severity, code, message) => findings.push({ severity, code, message })
  const meta = isObject(model?.meta) ? model.meta : {}
  const nodes = arr(model?.nodes)
  const edges = arr(model?.edges)
  const dm = isObject(domainModel) ? domainModel : {}
  const cid = context
  // the caller names the storming context: the DomainModel's own `context` is a BoundedContext artifact id, never one
  if (typeof cid !== 'string' || !cid) {
    return [{ severity: 'error', code: 'derived-unknown-context', message: 'no context given - name the storming context this domain model projects' }]
  }

  if (meta.level !== 'design') {
    add('error', 'derived-source-level', `source model is at level '${meta.level}' - a domain model is derived from a design-level storming`)
  }
  if (!arr(model?.contexts).some((c) => c.id === cid)) {
    add('error', 'derived-unknown-context', `context '${cid}' is not a context of the source model`)
  }
  if (findings.length > 0) return findings.sort(order) // nothing to compare against

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const label = (n) => trim(n?.label)
  const inContext = (n) => n?.context === cid
  const props = (n) => (isObject(n?.properties) ? n.properties : {})
  const ofType = (type) => nodes.filter((n) => n.type === type && inContext(n))
  // ponytail: linear edge scans - a model is a few hundred edges; index by relation if one ever is not
  const sources = (relation, id) => edges.filter((e) => e.relation === relation && e.target === id).map((e) => byId.get(e.source)).filter(Boolean)
  const targets = (relation, id) => edges.filter((e) => e.relation === relation && e.source === id).map((e) => byId.get(e.target)).filter(Boolean)
  const match = (list, name) => list.find((x) => trim(x.name) === name)

  const aggregates = ofType('aggregate')
  const dmAggregates = arr(dm.aggregates)
  diffLabels(add, 'aggregate', aggregates.map(label), dmAggregates.map((a) => trim(a.name)), 'derived-missing-aggregate', 'derived-extra-aggregate')
  for (const n of aggregates) {
    const a = match(dmAggregates, label(n))
    if (!a) continue
    const handled = sources('handledBy', n.id)
    diffLabels(add, `aggregate '${label(n)}' command`, handled.map(label), strs(a.commands), 'derived-command-mismatch')
    diffLabels(add, `aggregate '${label(n)}' event`, targets('emits', n.id).map(label), strs(a.events), 'derived-event-mismatch')
    const rules = handled.flatMap((c) => targets('constrainedBy', c.id)).map((k) => trim(props(k).rule ?? k.label))
    const statements = arr(a.invariants).map((i) => trim(i.statement))
    for (const s of statements) if (!rules.includes(s)) add('warning', 'derived-invariant-unsourced', `aggregate '${label(n)}': invariant '${s}' restates no storming constraint`)
    for (const r of rules) if (!statements.includes(r)) add('warning', 'derived-unused-constraint', `aggregate '${label(n)}': constraint '${r}' is in no invariant`)
  }

  const events = ofType('domainEvent')
  const dmEvents = arr(dm.events)
  diffLabels(add, 'event', events.map(label), dmEvents.map((e) => trim(e.name)), 'derived-missing-event', 'derived-extra-event')
  for (const n of events) {
    const e = match(dmEvents, label(n))
    if (!e) continue
    for (const flag of ['pivotal', 'temporal']) {
      if (!!props(n)[flag] !== !!e[flag]) add('error', 'derived-event-flag', `event '${label(n)}': ${flag} is ${!!e[flag]} in the domain model and ${!!props(n)[flag]} in the storming`)
    }
  }

  const policies = ofType('policy')
  const dmPolicies = arr(dm.policies)
  diffLabels(add, 'policy', policies.map(label), dmPolicies.map((p) => trim(p.name)), 'derived-policy-mismatch')
  for (const n of policies) {
    const p = match(dmPolicies, label(n))
    if (!p) continue
    diffLabels(add, `policy '${label(n)}' when`, sources('triggers', n.id).map(label), strs(p.when), 'derived-policy-mismatch')
    diffLabels(add, `policy '${label(n)}' then`, targets('invokes', n.id).map(label), strs(p.then), 'derived-policy-mismatch')
    for (const key of ['execution', 'condition']) {
      if (trim(props(n)[key]) !== trim(p[key])) add('error', 'derived-policy-mismatch', `policy '${label(n)}': ${key} '${p[key]}' is not the storming's '${props(n)[key]}'`)
    }
    if (parameterKey(p.parameters) !== parameterKey(props(n).parameters)) {
      add('error', 'derived-policy-mismatch', `policy '${label(n)}': parameters are not the storming's`)
    }
  }

  const readModels = ofType('readModel')
  const dmReadModels = arr(dm.readModels)
  diffLabels(add, 'read model', readModels.map(label), dmReadModels.map((r) => trim(r.name)), 'derived-readmodel-mismatch')
  for (const n of readModels) {
    const r = match(dmReadModels, label(n))
    if (!r) continue
    diffLabels(add, `read model '${label(n)}' informs`, targets('informs', n.id).map(label), strs(r.informs), 'derived-readmodel-mismatch')
    if (r.updatedBy !== undefined) {
      diffLabels(add, `read model '${label(n)}' updatedBy`, sources('updates', n.id).map(label), strs(r.updatedBy), 'derived-readmodel-mismatch')
    }
  }

  // An external system is outside every context: it belongs to this projection when an edge of it reaches into the context.
  const touching = (n) => edges.some((e) => (e.source === n.id && inContext(byId.get(e.target))) || (e.target === n.id && inContext(byId.get(e.source))))
  const externals = nodes.filter((n) => n.type === 'externalSystem' && touching(n))
  const dmExternals = arr(dm.externalSystems)
  diffLabels(add, 'external system', externals.map(label), dmExternals.map((x) => trim(x.name)), 'derived-external-mismatch')
  for (const n of externals) {
    const x = match(dmExternals, label(n))
    if (!x) continue
    const edgesOf = {
      issues: targets('issues', n.id),
      handles: sources('handledBy', n.id),
      emits: targets('emits', n.id),
    }
    for (const [key, reached] of Object.entries(edgesOf)) {
      if (x[key] === undefined) continue
      diffLabels(add, `external system '${label(n)}' ${key}`, reached.filter(inContext).map(label), strs(x[key]), 'derived-external-mismatch')
    }
  }

  return findings.sort(order)
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
        // at design the model is what a domain model is derived from, so an unanswered execution is a hole, not a smell
        add(level === 'design' ? 'error' : 'warning', 'policy-without-execution', `node ${nid}: policy '${n.label}' - no execution - automatic or manual?`)
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
