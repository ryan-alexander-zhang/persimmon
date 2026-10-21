// One Spec of the SDLC pack against the artifacts it cites (23-pack-sdlc.md, 27-spec-process.md): the Prd
// capability and its governing rules, the DomainModel's names, the Architecture's quality scenarios, the BusinessRules;
// inside the Spec, stories cover requirements and requirements enforce rules. And one Prd against the BusinessRules of
// its context. And one Design against the Architecture block it belongs to, the DomainModel its elements realise and the
// BusinessRules it enforces. And one Plan against its Spec, the Architecture and the Designs it realises. And one Architecture
// against the Prd, the contexts, models and glossaries it lists and the Adrs it applies. Plain data in, findings out.
// the document a Design of each type carries
import { bareSql, contractNames, designSystemNames, fieldNames, methods, uiParts } from './contract.mjs'

const mediaTypes = { 'http-api': ['application/openapi+yaml'], 'async-api': ['application/asyncapi+yaml'], 'data-schema': ['application/schema+json', 'application/sql'], ui: ['text/markdown'] }
const keyword = { ubiquitous: 'The', 'event-driven': 'When', 'state-driven': 'While', 'unwanted-behaviour': 'If', optional: 'Where' }

// unique and sequential from 1 in document order: a duplicate or a gap breaks the run
// unique and increasing in document order; a gap marks an item a revision removed, an id is never reused
const sequence = (bad, prefix, ids) => {
  let last = 0
  for (const id of ids) {
    const n = Number(String(id).slice(prefix.length + 1))
    if (!(n > last)) bad('id-sequence', `${id} is not above ${prefix}-${last}: ids are unique and increasing`)
    last = Math.max(last, n)
  }
}

// the names a Spec or a Design may cite from the DomainModel
const domainNames = (domainModel) => {
  const aggregates = domainModel?.aggregates ?? []
  const external = domainModel?.externalSystems ?? []
  const commands = new Set([...aggregates.flatMap((a) => a.commands ?? []), ...external.flatMap((e) => e.handles ?? []), ...external.flatMap((e) => e.issues ?? [])])
  // another context's event reaches the model only as a read model's updatedBy or an external system's emits
  const events = new Set([...(domainModel?.events ?? []).map((e) => e.name), ...(domainModel?.readModels ?? []).flatMap((r) => r.updatedBy ?? []), ...external.flatMap((e) => e.emits ?? [])])
  const readModels = new Set((domainModel?.readModels ?? []).map((r) => r.name))
  return { commands, events, readModels }
}

// Every BR-n is a pair with the BusinessRules artifact the document names in `businessRules` (33-multi-context-product.md):
// the citation is unqualified, so the document says which artifact, and the Validator holds it to the one bound.
// `upstream` is the document this one follows from (a Spec's Prd, a Design's Architecture, an Architecture's Prd): the
// rules bound must be the ones it names too, else a document copies the id it was bound with and two products' rules meet.
const rulesSource = (bad, doc, ids, upstream) => {
  if (doc.businessRules === undefined) bad('rules-mismatch', 'businessRules is absent: the artifact id of the BusinessRules the BR-n cite')
  else if (ids.rules && doc.businessRules !== ids.rules) bad('rules-mismatch', `businessRules ${doc.businessRules} is not ${ids.rules}, the BusinessRules bound`)
  if (upstream?.doc?.businessRules !== undefined && ids.rules && upstream.doc.businessRules !== ids.rules) bad('rules-mismatch', `${upstream.name} names businessRules ${upstream.doc.businessRules}, not ${ids.rules}, the BusinessRules bound`)
}

export function checkSpec({ spec, prd, domainModel, architecture, rules, context, base, ids = {} }) {
  if (!spec || !Array.isArray(spec.stories) || !Array.isArray(spec.requirements) || !spec.capability) {
    return [{ severity: 'error', code: 'not-a-spec', message: 'content is not a Spec: it has no stories array, no requirements array or no capability' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  rulesSource(bad, spec, ids, { name: 'the Prd', doc: prd })

  const capability = (prd?.capabilities ?? []).find((c) => c.id === spec.capability)
  // the Spec describes the capability it was written for: a finding the writer cannot fix is no licence to switch capability
  if (ids.capability && spec.capability !== ids.capability) bad('capability-mismatch', `capability ${spec.capability} is not ${ids.capability}, the capability this Spec was written for`)
  if (!capability) bad('unknown-capability', `capability ${spec.capability} is not a capability of the Prd`)
  // the capability lives in the BoundedContext that lists it, and the DomainModel is that context's (34-subdomains.md)
  else if (context && !(context.capabilities ?? []).includes(capability.id)) bad('context-mismatch', `${capability.id} is not a capability the bound BoundedContext lists`)
  if (context && ids.context && domainModel?.context !== ids.context) bad('context-mismatch', `the DomainModel's context ${domainModel?.context} is not ${ids.context}, the BoundedContext bound`)

  const { commands, events, readModels } = domainNames(domainModel)
  const scenarios = new Set((architecture?.qualityScenarios ?? []).map((q) => q.id))
  const status = new Map((rules?.rules ?? []).map((r) => [r.id, r.status]))
  const users = new Set((prd?.users ?? []).map((u) => u.name))

  const requirementIds = (spec.requirements ?? []).map((r) => r.id)
  const enforced = new Set()
  for (const fr of spec.requirements ?? []) {
    for (const r of fr.rules ?? []) {
      enforced.add(r)
      if (!status.has(r)) bad('unknown-rule', `${fr.id}: rule ${r} is not in the BusinessRules`)
      else if (status.get(r) !== 'active') bad('inactive-rule', `${fr.id}: rule ${r} is ${status.get(r)}, not active`)
    }
    const statement = String(fr.statement ?? '')
    const opens = statement.match(/^\s*([A-Za-z]+)/)?.[1]
    if (fr.pattern === 'complex') {
      const clauses = statement.split(/\bshall\b/)[0].match(/\b(while|when|if)\b/gi) ?? [] // the clauses before the response
      if (!['While', 'When', 'If'].includes(opens) || clauses.length < 2) {
        bad('pattern-mismatch', `${fr.id}: a complex statement opens with While, When or If and holds two such clauses`)
      }
    } else if (keyword[fr.pattern] && opens !== keyword[fr.pattern]) {
      bad('pattern-mismatch', `${fr.id}: a ${fr.pattern} statement opens with ${keyword[fr.pattern]}`)
    }
  }

  const covered = new Set()
  const storyIds = []
  const criterionStory = new Map() // AC-n → the story it is under: unique across the Spec, increasing within its story
  for (const story of spec.stories) {
    storyIds.push(story.id)
    if (!users.has(story.role)) bad('unknown-role', `${story.id}: role ${story.role} is not a Prd user`)
    for (const r of story.requirements ?? []) {
      covered.add(r)
      if (!requirementIds.includes(r)) bad('unknown-requirement', `${story.id}: requirement ${r} is not in the Spec`)
    }
    for (const c of story.commands ?? []) if (!commands.has(c)) bad('unknown-command', `${story.id}: command ${c} is not in the DomainModel`)
    for (const e of story.events ?? []) if (!events.has(e)) bad('unknown-event', `${story.id}: event ${e} is not in the DomainModel`)
    for (const r of story.readModels ?? []) if (!readModels.has(r)) bad('unknown-read-model', `${story.id}: read model ${r} is not in the DomainModel`)
    sequence(bad, 'AC', (story.acceptance ?? []).map((ac) => ac.id))
    for (const ac of story.acceptance ?? []) {
      if (criterionStory.has(ac.id) && criterionStory.get(ac.id) !== story.id) bad('id-sequence', `${ac.id} is under ${criterionStory.get(ac.id)} and ${story.id}: ids are unique`)
      criterionStory.set(ac.id, story.id)
    }
  }
  for (const id of requirementIds) if (!covered.has(id)) bad('requirement-uncovered', `requirement ${id} is covered by no story`)
  for (const r of capability?.rules ?? []) {
    if (!enforced.has(r)) bad('rule-unenforced', `rule ${r} governs ${capability.id} but no requirement enforces it`)
  }
  for (const q of spec.qualities ?? []) if (!scenarios.has(q.scenario)) bad('unknown-scenario', `scenario ${q.scenario} is not in the Architecture`)

  sequence(bad, 'FR', requirementIds)
  sequence(bad, 'US', storyIds)
  sequence(bad, 'Q', (spec.openQuestions ?? []).map((q) => q.id))

  // a Spec revised from base keeps its ids: the Plan and the TestDesign cite them (27-spec-process.md)
  if (base) {
    const baseStory = new Map((base.stories ?? []).flatMap((s) => (s.acceptance ?? []).map((ac) => [ac.id, s.id])))
    const kinds = { US: [storyIds, (base.stories ?? []).map((s) => s.id)], FR: [requirementIds, (base.requirements ?? []).map((r) => r.id)], AC: [[...criterionStory.keys()], [...baseStory.keys()]] }
    for (const [prefix, [now, was]] of Object.entries(kinds)) {
      const top = Math.max(0, ...was.map((id) => Number(String(id).slice(prefix.length + 1))))
      for (const id of now) if (!was.includes(id) && Number(String(id).slice(prefix.length + 1)) <= top) bad('id-reused', `${id} is not in the Spec it replaces, whose ids reach ${prefix}-${top}: a new item takes the next id`)
    }
    for (const [ac, story] of criterionStory) if (baseStory.has(ac) && baseStory.get(ac) !== story) bad('id-reused', `${ac} was under ${baseStory.get(ac)} in the Spec it replaces and is now under ${story}: a scenario keeps its id`)
  }
  return findings
}

export function checkPrd({ prd, rules, previousRules, feedback, ids = {} }) {
  if (!prd || !Array.isArray(prd.capabilities) || !prd.title) {
    return [{ severity: 'error', code: 'not-a-prd', message: 'content is not a Prd: it has no capabilities array or no title' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  rulesSource(bad, prd, ids)

  const status = new Map((rules?.rules ?? []).map((r) => [r.id, r.status]))
  const ruleSubdomain = new Map((rules?.rules ?? []).map((r) => [r.id, r.subdomain]))
  // the Prd names the product's subdomains (34-subdomains.md): a capability serves one of them and cites rules of that
  // subdomain, or untagged ones; with several subdomains every rule says whose policy it is
  const subdomains = (prd.subdomains ?? []).map((d) => d.id)
  const known = subdomains.join(', ')
  for (const [i, id] of subdomains.entries()) if (subdomains.indexOf(id) !== i) bad('subdomain-mismatch', `subdomain ${id} is named twice`)
  if (new Set(subdomains).size > 1) for (const r of rules?.rules ?? []) if (!r.subdomain) bad('subdomain-mismatch', `${r.id}: a product over ${subdomains.length} subdomains tags every rule with the subdomain whose policy it is`)
  for (const r of rules?.rules ?? []) if (r.subdomain && !subdomains.includes(r.subdomain)) bad('subdomain-mismatch', `${r.id}: subdomain ${r.subdomain} is not one of the Prd's (${known})`)
  const capabilityIds = prd.capabilities.map((c) => c.id)
  for (const cap of prd.capabilities) {
    for (const r of cap.rules ?? []) {
      if (!status.has(r)) bad('unknown-rule', `${cap.id}: rule ${r} is not in the BusinessRules`)
      else if (status.get(r) !== 'active') bad('inactive-rule', `${cap.id}: rule ${r} is ${status.get(r)}, not active`)
      else if (ruleSubdomain.get(r) && ruleSubdomain.get(r) !== cap.subdomain) bad('subdomain-mismatch', `${cap.id}: rule ${r} is a policy of ${ruleSubdomain.get(r)}, not the capability's ${cap.subdomain}`)
    }
    if (!subdomains.includes(cap.subdomain)) bad('subdomain-mismatch', `${cap.id}: subdomain ${cap.subdomain} is not one of the Prd's (${known})`)
  }
  for (const sc of prd.successCriteria ?? []) {
    for (const c of sc.capabilities ?? []) if (!capabilityIds.includes(c)) bad('unknown-capability', `${sc.id}: capability ${c} is not in the Prd`)
  }
  // a number belongs to a success criterion
  for (const g of prd.goals ?? []) if (/\d/.test(String(g.statement ?? ''))) bad('goal-with-number', `${g.id}: a goal states a direction without a number`)

  sequence(bad, 'BR', (rules?.rules ?? []).map((r) => r.id))
  // rule-drift: against the last round's rules, a BR-n dropped, or changed in statement or status, that no finding of the last verdict names (28-prd-process.md).
  // A GateResult holds its findings under results.<validator>; this gate's own rule-drift findings name the rule too and must not license the drift they refused
  if (previousRules?.rules) {
    const named = Object.values(feedback?.results ?? {}).flatMap((r) => r?.findings ?? []).filter((f) => f.code !== 'rule-drift').map((f) => f.message ?? '').join('\n')
    const now = new Map((rules?.rules ?? []).map((r) => [r.id, r]))
    for (const r of previousRules.rules) {
      if (new RegExp(`\\b${r.id}\\b`).test(named)) continue
      const cur = now.get(r.id)
      if (!cur) bad('rule-drift', `${r.id} was dropped and no finding asked for it`)
      else if (cur.statement !== r.statement || cur.status !== r.status) bad('rule-drift', `${r.id} changed unasked: no finding of the last round names it`)
    }
  }
  sequence(bad, 'G', (prd.goals ?? []).map((g) => g.id))
  sequence(bad, 'CAP', capabilityIds)
  sequence(bad, 'SC', (prd.successCriteria ?? []).map((s) => s.id))
  sequence(bad, 'Q', (prd.openQuestions ?? []).map((q) => q.id))
  return findings
}

// The `## <screen>` headings of a ui document: outside fenced code, closing hashes dropped (32-ui-design-process.md).
// The document's dialect is the block's technology (29-design-process.md): a word the named store lacks is a warning, never
// an error, since a word list is a heuristic. Only DDL, only stores the list knows; comments are stripped first.
const foreign = {
  sqlite: { words: ['INTERVAL', 'EXTRACT(', 'SERIAL', 'BIGSERIAL', 'CREATE SCHEMA', '::'], store: 'SQLite' },
  postgres: { words: ['AUTOINCREMENT', 'WITHOUT ROWID', 'DATETIME', 'NVARCHAR'], store: 'PostgreSQL' },
}
// a word matches whole (not inside an identifier), any whitespace between its parts, a `(` with any before it (`EXTRACT(` is the
// function, `extract` alone may be a column); `::` is a cast and sits between word characters
const wordRe = (w) => {
  const src = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+').replace(/\\\(/g, '\\s*\\(')
  return /^\w/.test(w) ? new RegExp(`(^|[^\\w])${src}${/\w$/.test(w) ? '(?![\\w])' : ''}`, 'i') : new RegExp(src)
}
const dialectMisses = (mediaType, sql, technology = '') => {
  if (mediaType !== 'application/sql') return []
  const named = Object.keys(foreign).filter((k) => new RegExp(k, 'i').test(technology))
  if (named.length !== 1) return [] // no store named, or two: nothing to hold the DDL to
  const bare = bareSql(sql)
  return foreign[named[0]].words.filter((w) => wordRe(w).test(bare)).map((w) => `${w} is not ${foreign[named[0]].store}, the store the block's technology names`)
}

// `ids.designSystem` is the bound DesignSystem's artifact id, which a content never carries; a ui Design must cite it and
// the Validator must have it bound, or the citation is unchecked. A ui Design realises operations, not DomainModel labels:
// `designs` is artifact id → content of the API Designs bound, and their element names are what its elements may realise;
// `designSystem` is the bound DesignSystem's content, whose front matter names what a screen's Layout may use
// (32-ui-design-process.md).
// A field name held to the Glossary (29-design-process.md): its words, split on case and `_`/`-`, are a term or a fact type's
// name less its subject and predicate (`claim has total`: `total`), an alias or a deprecated name the Glossary says not to write
// (an error), or a word it lacks (a warning). `id` and a name ending in `id`, any case, are the document's own.
// ponytail: whole-name match, one trailing `s` forgiven; stemming when a live Design shows the need
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-\s]+/g, ' ').trim().toLowerCase()
const vocabulary = (glossary) => {
  const fine = new Set()
  const avoid = new Map()
  for (const t of glossary?.terms ?? []) {
    if (t.status === 'deprecated') avoid.set(words(t.name), `${t.name} is deprecated${t.replacedBy ? `; the Glossary names ${t.replacedBy}` : ''}`)
    else fine.add(words(t.name))
    for (const a of t.aliases ?? []) avoid.set(words(a), `${a} is an alias; the Glossary names ${t.status === 'deprecated' && t.replacedBy ? t.replacedBy : t.name}`)
  }
  for (const f of glossary?.factTypes ?? []) {
    const n = words(f.name)
    const prefix = `${words(`${f.subject} ${f.predicate}`)} `
    const tail = n.startsWith(prefix) ? n.slice(prefix.length) : n
    if (f.status === 'deprecated') avoid.set(tail, `${f.name} is deprecated`)
    else fine.add(tail)
  }
  return { fine, avoid }
}
const isOperation = (name) => new RegExp(`^(${methods.map((m) => m.toUpperCase()).join('|')}) /`).test(name) // the methods contract.mjs names, as it spells them
const backticked = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
export function checkDesign({ design, architecture, domainModel, rules, designs = {}, designSystem, glossary, ids = {} }) {
  if (!design || !Array.isArray(design.elements) || !design.type) {
    return [{ severity: 'error', code: 'not-a-design', message: 'content is not a Design: it has no elements array or no type' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  rulesSource(bad, design, ids, { name: 'the Architecture', doc: architecture })
  const warn = (code, message) => findings.push({ severity: 'warning', code, message })

  const block = (architecture?.buildingBlocks ?? []).find((b) => b.id === design.block)
  if (!block) bad('unknown-block', `block ${design.block} is not a building block of the Architecture`)
  else if (design.interface !== undefined && !(block.interfaces ?? []).some((i) => i.name === design.interface && i.kind === 'provides')) {
    bad('unknown-interface', `interface ${design.interface} is not an interface ${design.block} provides`)
  }
  const mediaType = design.document?.mediaType
  const typed = mediaTypes[design.type]?.includes(mediaType)
  if (!typed) bad('type-mediatype', `type ${design.type} does not carry a document of mediaType ${mediaType}`)
  if (design.type === 'ui') {
    if (design.designSystem === undefined) bad('designsystem-mismatch', 'a ui Design names the DesignSystem its screens follow; designSystem is absent')
    else if (!ids.designSystem) bad('designsystem-mismatch', `designSystem ${design.designSystem} cannot be checked: no DesignSystem is bound to the Validator`)
    else if (design.designSystem !== ids.designSystem) bad('designsystem-mismatch', `designSystem ${design.designSystem} is not ${ids.designSystem}, the DesignSystem evaluated`)
    if (block && (block.contexts ?? []).length) bad('client-block', `block ${design.block} realises a context; a ui Design belongs to a client block`)
    if (design.domainModel !== undefined) bad('ui-domainmodel', `a ui Design realises operations of its block's API Designs, not a DomainModel; domainModel ${design.domainModel} is set`)
    if (!Object.keys(designs).length) bad('designs-unbound', 'a ui Design realises operations of the API Designs bound to the Validator; none is bound')
  }
  // the document is the truth and the index its view, both ways: every name the document declares has an element, every
  // element names something the document declares (a ui action, `<screen>: <control>`, is prose and only its screen is checked)
  const contract = typed ? contractNames(design.document) : undefined // a document of the wrong mediaType is that one finding
  if (contract?.error) bad('document-unparsed', `document cannot be read as ${mediaType}: ${contract.error}`)
  else if (contract) {
    const declared = new Set(contract.names)
    const indexed = new Set(design.elements.map((el) => el.name))
    const backed = (name) => typeof name === 'string' && (declared.has(name) || (design.type === 'ui' && [...declared].some((s) => name.startsWith(`${s}: `)))) // a ui action is `<screen>: <control>`, whichever screen that is
    for (const el of design.elements) if (!backed(el.name)) bad('element-unbacked', `${el.id}: ${el.name} is not in the document`)
    for (const name of declared) if (!indexed.has(name)) bad('document-unindexed', `${name} is in the document and has no element`)
    for (const m of dialectMisses(mediaType, design.document?.content ?? '', block?.technology)) warn('dialect', m)
  }

  const ui = design.type === 'ui'
  if (!ui && !domainModel) bad('domainmodel-unbound', 'a Design realises labels of the DomainModel bound to the Validator; none is bound')
  const { commands, events, readModels } = domainNames(domainModel)
  const known = ui
    ? { operation: new Set(Object.values(designs).flatMap((d) => (d?.elements ?? []).map((e) => e.name))) }
    : { command: commands, event: events, readModel: readModels, aggregate: new Set((domainModel?.aggregates ?? []).map((a) => a.id)) }
  const realisable = ui ? Object.keys(designs).length > 0 : !!domainModel // an unbound source is one finding, not one per element
  const status = new Map((rules?.rules ?? []).map((r) => [r.id, r.status]))
  const ruleCheck = (owner, r) => {
    if (!status.has(r)) bad('unknown-rule', `${owner}: rule ${r} is not in the BusinessRules`)
    else if (status.get(r) !== 'active') bad('inactive-rule', `${owner}: rule ${r} is ${status.get(r)}, not active`)
  }
  const union = new Set(design.rules ?? [])
  const placed = new Set(design.elements.flatMap((el) => el.rules ?? []))

  // a ui screen's prose, read past the index (32-ui-design-process.md): a `METHOD /path` in backticks under Actions is an operation
  // of the API Designs bound; an action element's operation is in its screen's Actions; a backticked name under Layout is a
  // component or token of the DesignSystem, as advice, since a live Layout also names fields in backticks
  if (ui && contract && !contract.error) {
    const parts = uiParts(design.document.content)
    const actionsOf = (screen) => parts.filter((p) => p.screen === screen && p.part === 'Actions').map((p) => p.text).join('\n')
    for (const p of parts.filter((p) => p.part === 'Actions')) {
      for (const op of new Set(backticked(p.text).filter(isOperation))) if (realisable && !known.operation.has(op)) bad('action-unknown', `${p.screen}: ${op} is not an operation of the API Designs bound`)
    }
    const declared = new Set(contract.names)
    for (const el of design.elements) {
      if (typeof el.name !== 'string' || declared.has(el.name)) continue // a screen element, not an action
      const screen = [...declared].filter((s) => el.name.startsWith(`${s}: `)).sort((a, b) => b.length - a.length)[0] // the longest: `Claims: Detail` over `Claims`
      const op = el.realises?.name
      if (screen && typeof op === 'string' && !backticked(actionsOf(screen)).includes(op)) bad('action-unbacked', `${el.id}: ${op} is not in the Actions of ${screen}`)
    }
    const names = designSystemNames(designSystem?.document?.content)
    const seen = new Set()
    if (names) for (const p of parts.filter((p) => p.part === 'Layout')) for (const t of backticked(p.text)) if (!names.has(t) && !seen.has(t) && seen.add(t)) warn('layout-unknown', `${p.screen}: \`${t}\` is not a component or token of the DesignSystem`)
  }

  // the document's fields past the index: a name the Glossary says not to write is an error, one it lacks a warning, each once
  // per document; a ui document binds no Glossary, and a Validator with none bound checks no field
  if (!ui && glossary && contract && !contract.error) {
    const { fine, avoid } = vocabulary(glossary)
    const seen = new Set()
    for (const name of fieldNames(design.document)) {
      const w = words(name)
      if (/(^| )id$/.test(w) || seen.has(name)) continue
      seen.add(name)
      // the name as written first, then one trailing `s` forgiven: `caps` is the alias `cap`, `lines` an alias before `line` a term
      const why = avoid.get(w) ?? (fine.has(w) || fine.has(w.replace(/s$/, '')) ? undefined : avoid.get(w.replace(/s$/, '')))
      if (!why && (fine.has(w) || fine.has(w.replace(/s$/, '')))) continue
      if (why) bad('alias-used', `${name}: ${why}`)
      else warn('term-unknown', `${name}: no term or fact type of the Glossary names it`)
    }
  }

  for (const el of design.elements) {
    const { kind, name } = el.realises ?? {}
    if (realisable && !known[kind]?.has(name)) bad('unknown-realised', `${el.id}: ${kind} ${name} is not in ${ui ? 'the API Designs bound' : 'the DomainModel'}`)
    for (const r of el.rules ?? []) {
      ruleCheck(el.id, r)
      if (!union.has(r)) bad('rules-incomplete', `${el.id}: rule ${r} is not in the Design's rules, the union of the elements'`)
    }
  }
  for (const r of design.rules ?? []) {
    ruleCheck(design.title, r)
    if (!placed.has(r)) bad('rules-unplaced', `${design.title}: rule ${r} is in the Design's rules but no element lists it`)
  }

  sequence(bad, 'EL', design.elements.map((e) => e.id))
  sequence(bad, 'Q', (design.openQuestions ?? []).map((q) => q.id))
  return findings
}

// One DomainModel against every Design that names it (29-design-process.md): each of the model's own names, an aggregate's
// command, an `events[]` name, a read model, an `AG-n`, has an element of some Design realising it, or is `unrealised`, a
// warning, since a contract not written yet is not a defect of one that is; a command a policy invokes and an event an
// external system emits are `unrealised-internal`, an info. External systems' commands and other contexts' events are
// not the model's own. `designs` is artifact id → content; a Design naming another model, or none
// (a ui Design), is not read. `ids.domainModel` is the bound model's artifact id.
export function checkCoverage({ domainModel, designs = {}, ids = {} }) {
  if (!domainModel || !Array.isArray(domainModel.aggregates)) {
    return [{ severity: 'error', code: 'not-a-domainmodel', message: 'content is not a DomainModel: it has no aggregates array' }]
  }
  const realised = { command: new Set(), event: new Set(), readModel: new Set(), aggregate: new Set() }
  for (const d of Object.values(designs)) if (d?.domainModel === ids.domainModel) for (const el of d.elements ?? []) realised[el.realises?.kind]?.add(el.realises.name)
  const want = [
    ...domainModel.aggregates.flatMap((a) => (a.commands ?? []).map((c) => ['command', c])),
    ...(domainModel.events ?? []).map((e) => ['event', e.name]),
    ...(domainModel.readModels ?? []).map((r) => ['readModel', r.name]),
    ...domainModel.aggregates.map((a) => ['aggregate', a.id]),
  ]
  // a command a policy invokes is the system's own reaction: a handler realises it, no API operation does, so it is noted as
  // internal (info), not a gap. ponytail: the model does not say who else issues it; one an actor also issues is noted the same
  const invokedBy = new Map()
  for (const p of domainModel.policies ?? []) for (const c of p.then ?? []) if (!invokedBy.has(c)) invokedBy.set(c, p.name)
  // an event an outside system emits reaches the model from outside: no Design of the model publishes it
  const emittedBy = new Map()
  for (const x of domainModel.externalSystems ?? []) for (const e of x.emits ?? []) if (!emittedBy.has(e)) emittedBy.set(e, x.name)
  const internal = (kind, name) =>
    kind === 'command' && invokedBy.has(name) ? `invoked by ${invokedBy.get(name)}; no Design of ${ids.domainModel} realises it, a handler does`
      : kind === 'event' && emittedBy.has(name) ? `emitted by ${emittedBy.get(name)}, outside the model; no Design of ${ids.domainModel} publishes it`
        : undefined
  const seen = new Set()
  return want.filter(([kind, name]) => !realised[kind].has(name) && !seen.has(`${kind}/${name}`) && seen.add(`${kind}/${name}`)).map(([kind, name]) => {
    const why = internal(kind, name)
    return why
      ? { severity: 'info', code: 'unrealised-internal', message: `${kind} ${name}: ${why}` }
      : { severity: 'warning', code: 'unrealised', message: `${kind} ${name}: no Design of ${ids.domainModel} realises it` }
  })
}

// One Plan against the Spec it builds, the Architecture its tasks name blocks of, and the Designs it realises elements
// of; `designs` is artifact id → content, paired by the caller from inputs.designs.refs and artifacts.designs.
// `ids` are the bound inputs' artifact ids, `{spec, architecture}`, which a content never carries. `domainModel`: which
// aggregate handles each command; `base`: the Plan this one replaces, whose task ids it keeps.
export function checkPlan({ plan, spec, architecture, designs = {}, domainModel, base, ids = {} }) {
  if (!plan || !Array.isArray(plan.tasks) || !plan.spec) {
    return [{ severity: 'error', code: 'not-a-plan', message: 'content is not a Plan: it has no tasks array or no spec' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })

  const requirements = new Set((spec?.requirements ?? []).map((r) => r.id))
  const scenarios = new Set((spec?.stories ?? []).flatMap((s) => (s.acceptance ?? []).map((a) => a.id)))
  // the quality scenarios a task must verify: the Spec cites them and the Architecture proves them at build
  const provenAt = new Map((architecture?.qualityScenarios ?? []).map((q) => [q.id, q.provenAt]))
  const cited = new Set((spec?.qualities ?? []).map((q) => q.scenario))
  const blocks = new Set((architecture?.buildingBlocks ?? []).map((b) => b.id))
  if (ids.spec && plan.spec !== ids.spec) bad('spec-mismatch', `spec ${plan.spec} is not ${ids.spec}, the Spec evaluated`)
  if (ids.architecture && plan.architecture !== ids.architecture) bad('architecture-mismatch', `architecture ${plan.architecture} is not ${ids.architecture}, the Architecture evaluated`)
  const listed = new Set(plan.designs ?? [])
  if (listed.size !== (plan.designs ?? []).length) bad('design-duplicate', 'designs lists an artifact id twice')
  const covered = new Set()
  const verified = new Set()
  const used = new Set()
  const taskIds = plan.tasks.map((t) => t.id)
  const number = (id) => Number(String(id).slice(2))

  for (const t of plan.tasks) {
    if (!blocks.has(t.block)) bad('unknown-block', `${t.id}: block ${t.block} is not a building block of the Architecture`)
    for (const r of t.covers ?? []) {
      covered.add(r)
      if (!requirements.has(r)) bad('unknown-requirement', `${t.id}: requirement ${r} is not in the Spec`)
    }
    for (const a of t.verifiedBy ?? []) {
      verified.add(a)
      if (a.startsWith('QS-')) {
        if (!cited.has(a)) bad('unknown-scenario', `${t.id}: quality scenario ${a} is not one the Spec cites`)
        else if (!provenAt.has(a)) bad('unknown-scenario', `${t.id}: quality scenario ${a} is not in the Architecture`)
        else if (provenAt.get(a) !== 'build') bad('scenario-not-build', `${t.id}: quality scenario ${a} is proven at ${provenAt.get(a)}, not at build`)
      } else if (!scenarios.has(a)) bad('unknown-scenario', `${t.id}: scenario ${a} is not in the Spec`)
    }
    for (const d of t.dependsOn ?? []) {
      if (!taskIds.includes(d)) bad('unknown-task', `${t.id}: depends on ${d}, not a task of the Plan`)
      else if (!(number(d) < number(t.id))) bad('dependency-forward', `${t.id}: depends on ${d}, not an earlier task; document order is build order`)
    }
    for (const { design, element } of t.elements ?? []) {
      used.add(design)
      if (!listed.has(design)) bad('unknown-design', `${t.id}: design ${design} is not in the Plan's designs`)
      else if (!designs[design]) bad('design-unread', `${t.id}: design ${design} is not among the Designs evaluated`)
      else {
        if (designs[design].block !== t.block) bad('design-block', `${t.id}: design ${design} is of block ${designs[design].block}, the task is on ${t.block}`)
        if (!(designs[design].elements ?? []).some((e) => e.id === element)) bad('unknown-element', `${t.id}: element ${element} is not in design ${design}`)
      }
    }
  }
  for (const id of requirements) if (!covered.has(id)) bad('requirement-unplanned', `requirement ${id} is covered by no task`)
  for (const id of scenarios) if (!verified.has(id)) bad('scenario-unverified', `scenario ${id} verifies no task`)
  for (const id of cited) if (provenAt.get(id) === 'build' && !verified.has(id)) bad('scenario-unverified', `quality scenario ${id} is proven at build but verifies no task`)
  for (const d of listed) if (!used.has(d)) bad('design-unused', `design ${d} is listed but no task realises an element of it`)
  // the elements the capability needs: its stories' commands and read models, and the aggregates handling those commands
  const commands = (spec?.stories ?? []).flatMap((s) => s.commands ?? [])
  const needed = new Set([...commands, ...(spec?.stories ?? []).flatMap((s) => s.readModels ?? [])])
  for (const a of domainModel?.aggregates ?? []) if ((a.commands ?? []).some((c) => commands.includes(c.name ?? c))) needed.add(a.id).add(a.name)
  const realised = new Set(plan.tasks.flatMap((t) => (t.elements ?? []).map((e) => `${e.design} ${e.element}`)))
  for (const [id, d] of Object.entries(designs)) {
    for (const e of d?.elements ?? []) if (needed.has(e.realises?.name) && !realised.has(`${id} ${e.id}`)) bad('element-unplanned', `${id} ${e.id} (${e.name}) realises ${e.realises.name}, which the capability needs, but no task realises it`)
  }

  // a task of the Plan this one replaces keeps its id: its AcceptanceRecord is <plan>-<t-n> (30-plan-process.md)
  const work = (t) => [...(t.covers ?? []), ...(t.verifiedBy ?? []), ...(t.elements ?? []).map((e) => `${e.design} ${e.element}`)]
  for (const b of base?.tasks ?? []) {
    const now = plan.tasks.find((t) => t.id === b.id)
    // a warning: a new task an old one needs can only come first under a lower id, so renumbering may be right, and is told
    if (now && (now.block !== b.block || !work(b).some((w) => work(now).includes(w)))) findings.push({ severity: 'warning', code: 'task-renumbered', message: `${b.id} was "${b.title}" in the Plan it replaces and is now "${now.title}": its AcceptanceRecord now names other work` })
  }
  sequence(bad, 'T', taskIds)
  sequence(bad, 'Q', (plan.openQuestions ?? []).map((q) => q.id))
  return findings
}

const red = (c) => c.status === 'failed' || c.status === 'errored'

/** One level's suite against its baseline (35-build-process.md): a red case no row names is a break unless the baseline had it red;
 * a non-zero exit no red case explains is a suite killed or failing after its tests. `named`: the cases rows name. Messages
 * carry `prefix`, the level when it is not unit. */
function suiteFindings(outcome, baseline, named, prefix, bad, findings) {
  const cases = outcome.tests ?? []
  // a case red before the build is not the build's: tolerated while still red, listed; one the baseline lacks or had green is a break
  const redBefore = new Set((baseline?.tests ?? []).filter(red).map((c) => `${c.classname} > ${c.name}`))
  const tolerated = new Set()
  for (const c of cases) {
    if (named.has(c) || !red(c)) continue
    if (redBefore.has(`${c.classname} > ${c.name}`)) tolerated.add(`${c.classname} > ${c.name}`)
    else bad('suite-failed', `${prefix}${c.classname} > ${c.name} ${c.status}${c.message ? `: ${c.message}` : ''}`)
  }
  if (tolerated.size) findings.push({ severity: 'info', code: 'suite-baseline', message: `${prefix}${tolerated.size} test${tolerated.size > 1 ? 's' : ''} red in the baseline, red still: ${[...tolerated].join('; ')}` })
  // persimmon never reverts: a baseline taken over uncommitted changes may tolerate a red an earlier build left
  if (tolerated.size && baseline.dirty) findings.push({ severity: 'warning', code: 'baseline-dirty', message: `${prefix}the baseline ran over uncommitted changes: a red it tolerates may be one an earlier build left` })
  // a tolerated red explains a non-zero exit only when the baseline exited the same: a suite killed or failing after its tests still shows
  const onlyTolerated = cases.filter(red).every((c) => !named.has(c) && tolerated.has(`${c.classname} > ${c.name}`))
  if (outcome.exitCode !== 0 && onlyTolerated && outcome.exitCode !== (cases.some(red) ? baseline.exitCode : 0)) bad('suite-exit', `${prefix}the tests exited ${outcome.exitCode} with no test failing${cases.some(red) ? ` beyond the baseline's, which exited ${baseline.exitCode}` : ''}: killed part way, or failed after the tests`)
}

const levelOf = (o) => o?.level ?? 'unit'
const ran = (o) => o && o.selection?.mode !== 'none'

/** A case's id as a test names it, `<CAP-n>/TC-n`: each Spec numbers its cases from 1 (39-test-process.md). */
export const qualified = (spec, id) => `${spec?.capability}/${id}`
/** Whether a test, by its `classname > name`, carries a qualified case id as a whole token: CAP-1/TC-1 is not in CAP-1/TC-10. */
export const carries = (test, qid) => new RegExp(`(^|[^\\w/-])${qid.replace('/', '\\/')}(?![\\w-])`).test(`${test.classname} > ${test.name}`)
/** The TestDesign's cases that verify a scenario of the task's `verifiedBy`, each with its qualified id. */
export function taskCases({ plan, taskId, spec, testDesign }) {
  const due = new Set((plan?.tasks ?? []).find((t) => t.id === taskId)?.verifiedBy ?? [])
  return (testDesign?.cases ?? []).filter((c) => (c.verifies ?? []).some((v) => due.has(v))).map((c) => ({ ...c, qid: qualified(spec, c.id) }))
}
/** What one build round runs (39-test-process.md): the task's automated case ids by level, its manual ones, and whether the
 * Tester writes this round's api and e2e tests: in round one when the task has such cases, later when an error finding names
 * one; a warning refuses no round. */
export function selectCases({ plan, taskId, spec, testDesign, feedback }) {
  const cases = taskCases({ plan, taskId, spec, testDesign })
  const of = (level) => cases.filter((c) => c.execution !== 'manual' && c.level === level).map((c) => c.qid)
  const named = Object.values(feedback?.results ?? {}).flatMap((r) => r?.findings ?? []).filter((f) => f.severity === 'error').map((f) => f.message ?? '').join('\n')
  const write = (level) => of(level).length > 0 && (!feedback || of(level).some((q) => named.includes(q)))
  return { unit: of('unit'), integration: of('integration'), api: of('api'), e2e: of('e2e'), manual: cases.filter((c) => c.execution === 'manual').map((c) => c.qid), write: { api: write('api'), e2e: write('e2e') } }
}

/** One TestHarness against the seed runs of its levels (39-test-process.md): every level ran and its seed test is green.
 * `seed`: the unit level's outcome; `levelOutcomes` the others'. `ids`: {architecture} bound. Every finding `error`. */
export function checkHarness({ harness, seed, levelOutcomes = [], designs = {}, base, ids = {} }) {
  if (!harness?.levels?.unit) return [{ severity: 'error', code: 'not-a-harness', message: 'content is not a TestHarness: it has no levels.unit' }]
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  if (ids.architecture && harness.architecture !== ids.architecture) bad('architecture-mismatch', `architecture ${harness.architecture} is not ${ids.architecture}, the Architecture bound`)
  const outcomes = new Map([...(seed ? [['unit', seed]] : []), ...levelOutcomes.map((o) => [levelOf(o), o])])
  for (const [level, l] of Object.entries(harness.levels)) {
    const o = outcomes.get(level)
    if (!o || !ran(o)) {
      bad('level-unrun', `${level}: the seed run has no outcome for it`)
      continue
    }
    if ((o.tests ?? []).length === 0) {
      bad('suite-empty', empty(o, `${level}: `))
      continue
    }
    const m = (o.tests ?? []).filter((c) => c.name === l.seed || `${c.classname} > ${c.name}` === l.seed)
    if (m.length === 0) bad('seed-missing', `${level}: no test is named ${l.seed}`)
    else if (!m.every((c) => c.status === 'passed')) bad('seed-failed', `${level}: ${l.seed} ${m.find((c) => c.status !== 'passed').status}`)
  }
  // a harness set up again keeps the levels the cases name (39-test-process.md)
  for (const level of Object.keys(base?.levels ?? {})) if (!harness.levels[level]) bad('level-dropped', `${level}: a level of the harness this one replaces is gone; the cases of that level have nothing to run on`)
  // an e2e level may wait for the screens its seed opens, and is told while it waits (39-test-process.md)
  const ui = Object.entries(designs).filter(([, d]) => d?.type === 'ui').map(([id]) => id)
  if (ui.length && !harness.levels.e2e) findings.push({ severity: 'warning', code: 'level-deferred', message: `${ui.join(', ')} ${ui.length > 1 ? 'are ui Designs' : 'is a ui Design'} and the harness has no e2e level: run setup-tests again once the screens are built` })
  return findings
}

/** One TestDesign against its Spec, the Architecture's quality scenarios, the BusinessRules, the TestHarness and the Plan
 * (39-test-process.md): an api step's `METHOD /path` is a Design element its case's task, or one before it, realises.
 * `designs` maps a Design id to its content; `base`, the TestDesign this one replaces, whose ids it keeps. `ids`: {spec,
 * harness} bound. Every finding `error`. */
export function checkTestDesign({ testDesign, spec, architecture, rules, harness, plan, designs = {}, base, ids = {} }) {
  if (!testDesign || !Array.isArray(testDesign.cases) || !testDesign.spec) {
    return [{ severity: 'error', code: 'not-a-test-design', message: 'content is not a TestDesign: it has no cases array or no spec' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  if (ids.spec && testDesign.spec !== ids.spec) bad('spec-mismatch', `spec ${testDesign.spec} is not ${ids.spec}, the Spec bound`)
  if (ids.harness && testDesign.harness !== ids.harness) bad('harness-mismatch', `harness ${testDesign.harness} is not ${ids.harness}, the TestHarness bound`)
  const acs = (spec?.stories ?? []).flatMap((s) => (s.acceptance ?? []).map((a) => a.id))
  const provenAt = new Map((architecture?.qualityScenarios ?? []).map((q) => [q.id, q.provenAt]))
  const cited = (spec?.qualities ?? []).map((q) => q.scenario)
  const known = new Set([...acs, ...cited, ...(spec?.requirements ?? []).map((r) => r.id), ...(rules?.rules ?? []).map((r) => r.id)])
  const levels = new Set(Object.keys(harness?.levels ?? {}))
  const tasks = plan?.tasks ?? []
  const realisedAt = new Map() // a Design element's name, `METHOD /path`, to the first task realising it
  tasks.forEach((t, i) => {
    for (const e of t.elements ?? []) {
      const name = (designs[e.design]?.elements ?? []).find((x) => x.id === e.element)?.name
      if (name && !realisedAt.has(name)) realisedAt.set(name, i)
    }
  })
  const verified = new Set()
  for (const c of testDesign.cases) {
    for (const v of c.verifies ?? []) {
      verified.add(v)
      if (!known.has(v)) bad('unknown-reference', `${c.id}: ${v} is not in the Spec, the rules or the quality scenarios it cites`)
    }
    if (!(c.verifies ?? []).some((v) => /^(AC|QS)-/.test(v))) bad('case-unanchored', `${c.id} verifies no AC-n and no QS-n`)
    if (harness && !levels.has(c.level)) bad('level-unavailable', `${c.id}: the harness has no ${c.level} level`)
    if ((c.level === 'api' || c.level === 'e2e' || c.execution === 'manual') && !(c.steps ?? []).length) bad('steps-missing', `${c.id}: a${c.execution === 'manual' ? ' manual' : `n ${c.level}`} case names its steps`)
    if (c.priority === 'P0' && c.execution === 'manual') bad('p0-manual', `${c.id}: a P0 case is automated`)
    const at = tasks.findIndex((t) => (t.verifiedBy ?? []).some((v) => (c.verifies ?? []).includes(v)))
    for (const s of c.level === 'api' && at >= 0 ? c.steps ?? [] : []) {
      const op = /^[A-Z]+ \S+/.exec(s.action ?? '')?.[0]
      if (realisedAt.get(op) > at) bad('step-premature', `${c.id}: ${op} is built by ${tasks[realisedAt.get(op)].id}, after ${tasks[at].id}, the task of this case`)
    }
  }
  const anchors = (c) => (c?.verifies ?? []).filter((v) => /^(AC|QS)-/.test(v))
  for (const b of base?.cases ?? []) {
    const now = anchors(testDesign.cases.find((c) => c.id === b.id))
    if (now.length && !anchors(b).some((v) => now.includes(v))) bad('case-renumbered', `${b.id} verified ${anchors(b).join(', ')} in the TestDesign it replaces and now verifies ${now.join(', ')}: a case keeps its id`)
  }
  for (const id of acs) if (!verified.has(id)) bad('scenario-uncovered', `${id}: no case verifies it`)
  for (const id of cited) if (provenAt.get(id) === 'build' && !verified.has(id)) bad('scenario-uncovered', `quality scenario ${id} is proven at build but no case verifies it`)
  sequence(bad, 'TC', testDesign.cases.map((c) => c.id))
  sequence(bad, 'Q', (testDesign.openQuestions ?? []).map((q) => q.id))
  return findings
}
const empty = (o, prefix) => `${prefix}no test ran (exit ${o?.exitCode}): ${o?.outputTail ?? ''}`
/** A row's test as {name, level}: a bare name is a unit test (36-test-levels.md). */
const testRef = (t) => (typeof t === 'string' ? { name: t, level: 'unit' } : t)

/** One AcceptanceRecord against the TestOutcomes of its round, the Plan task it builds and the Spec (35-build-process.md): the
 * record is the builder's claim, the outcomes the evidence. `ids`: {plan, spec, taskId} bound beside it; `previous` and
 * `previousOutcome`: the last round's record and unit tests; a unit test it named that ran then must still run. A test is named by string equality with a case's `name` or with
 * `classname > name`, never split; cases with the same classname and name (a retried or parameterized test) are one test, red
 * if any of them is. `baseline`: the tests before build-all; a case red there and red still is tolerated. `levelOutcomes` and
 * `levelBaselines`: the other test levels' (36-test-levels.md), paired by `level`; a row's `{name, level}` resolves in its level's
 * outcome, and the unit outcome carries the coverage and mutation minimums. With `testDesign` bound no row is read: the task's
 * cases are, each by the tests carrying its qualified id (39-test-process.md). Every finding `error` but `suite-baseline`,
 * `level-held` and `case-manual` (info), `baseline-dirty` and `defect-reported` (warning). */
export function checkAcceptance({ record, testOutcome, plan, spec, previous, previousOutcome, baseline, levelOutcomes = [], levelBaselines = [], testDesign, ids = {} }) {
  if (!record || !record.task || (!Array.isArray(record.verifies) && !testDesign)) {
    return [{ severity: 'error', code: 'not-a-record', message: `content is not an AcceptanceRecord: it has no task${testDesign ? '' : ' or no verifies array'}` }]
  }
  const cases = testOutcome?.tests ?? []
  if (cases.length === 0 && ran(testOutcome ?? {})) return [{ severity: 'error', code: 'suite-empty', message: empty(testOutcome, '') }]
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  const outcomes = new Map([['unit', testOutcome], ...levelOutcomes.map((o) => [levelOf(o), o])])
  const baselines = new Map([['unit', baseline], ...levelBaselines.map((o) => [levelOf(o), o])])
  const prefixOf = (level) => (level === 'unit' ? '' : `${level}: `)

  if (ids.taskId && record.task !== ids.taskId) bad('task-mismatch', `task ${record.task} is not ${ids.taskId}, the task built`)
  if (ids.plan && record.plan !== ids.plan) bad('plan-mismatch', `plan ${record.plan} is not ${ids.plan}, the Plan evaluated`)
  if (ids.spec && record.spec !== ids.spec) bad('spec-mismatch', `spec ${record.spec} is not ${ids.spec}, the Spec evaluated`)
  if (ids.spec && plan?.spec && plan.spec !== ids.spec) bad('spec-mismatch', `the Plan builds ${plan.spec}, not ${ids.spec}, the Spec evaluated`)
  const task = (plan?.tasks ?? []).find((t) => t.id === record.task)
  if (!task) bad('unknown-task', `task ${record.task} is not a task of the Plan`)
  const due = new Set(task?.verifiedBy ?? [])
  // a QS-n the Spec cites; when it is proven is the Plan check's, which reads the Architecture
  const scenarios = new Set([...(spec?.stories ?? []).flatMap((s) => (s.acceptance ?? []).map((a) => a.id)), ...(spec?.qualities ?? []).map((q) => q.scenario)])

  const matching = (name, level = 'unit') => (outcomes.get(level)?.tests ?? []).filter((c) => c.name === name || `${c.classname} > ${c.name}` === name)
  const tests = (m) => new Set(m.map((c) => `${c.classname} > ${c.name}`)).size
  const named = new Set()
  const seen = new Set()
  for (const id of due) if (!scenarios.has(id)) bad('unknown-scenario', `${id} verifies ${record.task} but is not in the Spec: the Spec was revised after the Plan`)
  if (testDesign) caseFindings({ cases: taskCases({ plan, taskId: record.task, spec, testDesign }), outcomes, named, bad, findings })
  else rowFindings()
  function rowFindings() {
    for (const row of record.verifies) {
      const id = row.scenario
      if (seen.has(id)) bad('scenario-duplicate', `${id} has two rows`)
      seen.add(id)
      if (task && !due.has(id)) bad('unknown-scenario', `${id} does not verify ${record.task}`)
      for (const { name, level } of (row.tests ?? []).map(testRef)) {
        const o = outcomes.get(level)
        const where = level === 'unit' ? '' : `${level} `
        // a held level ran nothing: the red before it already fails the round, told once as level-held
        if (o?.selection?.mode === 'none' && o.selection.reason.startsWith('held')) continue
        if (!o) {
          bad('test-missing', `${id}: no ${level} test ran: the project configures no ${level} level`)
          continue
        }
        if (!ran(o)) {
          bad('test-missing', `${id}: ${name}: the ${level} tests did not run (${o.selection.reason})`)
          continue
        }
        if ((o.tests ?? []).length === 0) continue // that level's suite-empty says why
        const m = matching(name, level)
        for (const c of m) named.add(c)
        if (m.length === 0) bad('test-missing', `${id}: no ${where}test is named ${name}`)
        else if (tests(m) > 1) bad('test-ambiguous', `${id}: ${tests(m)} ${where}tests are named ${name}; name it as classname > name`)
        else if (m.some(red)) {
          const r = m.find(red)
          bad('test-failed', `${id}: ${name} ${r.status}${r.message ? `: ${r.message}` : ''}`)
        } else if (m.every((c) => c.status === 'skipped')) bad('test-skipped', `${id}: ${name} was skipped`)
      }
    }
    for (const id of due) if (!seen.has(id)) bad('scenario-unrecorded', `${id} verifies ${record.task} but the record names no test for it`)
    // the unit tests only: previousOutcome is the unit one; a name the last round got wrong never ran, so only a test that ran then can be dropped now
    const unitNames = (r) => (r?.verifies ?? []).flatMap((x) => (x.tests ?? []).map(testRef)).filter((t) => t.level === 'unit').map((t) => t.name)
    const current = new Set(unitNames(record))
    const ranBefore = (n) => (previousOutcome?.tests ?? []).some((c) => c.name === n || `${c.classname} > ${c.name}` === n)
    const dropped = new Set(unitNames(previous).filter((n) => !current.has(n) && ranBefore(n) && matching(n).length === 0))
    for (const name of dropped) bad('test-dropped', `${name}, named last round, no longer runs`)
  }
  if (ran(testOutcome)) suiteFindings(testOutcome, baseline, named, '', bad, findings)
  measures(testOutcome, bad)
  for (const [level, o] of outcomes) {
    if (level === 'unit') continue
    if (o.selection?.mode === 'none') {
      if (o.selection.reason.startsWith('held')) findings.push({ severity: 'info', code: 'level-held', message: `${level} ran nothing, ${o.selection.reason}: fix the red first` })
      continue
    }
    if ((o.tests ?? []).length === 0) bad('suite-empty', empty(o, prefixOf(level)))
    else suiteFindings(o, baselines.get(level), named, prefixOf(level), bad, findings)
  }
  for (const q of record.openQuestions ?? []) if (!q.resolution) bad('question-open', `${q.id} is open: ${q.question}`)
  // wrong behaviour the task does not cover: reported, never this task's to fix, so told every round and never refused
  for (const d of record.defects ?? []) findings.push({ severity: 'warning', code: 'defect-reported', message: `${d.id} at ${d.where}: ${d.observed}; expected ${d.expected}` })
  return findings
}

/** A task's cases against the round's outcomes (39-test-process.md): a test carries a case by its qualified id; every test
 * that carries one is named, so a red one is the case's finding, not `suite-failed`. */
function caseFindings({ cases, outcomes, named, bad, findings }) {
  const manual = cases.filter((c) => c.execution === 'manual').map((c) => c.qid)
  if (manual.length) findings.push({ severity: 'info', code: 'case-manual', message: `no test runs ${manual.join(', ')}: manual` })
  for (const c of cases.filter((c) => c.execution !== 'manual')) {
    const o = outcomes.get(c.level)
    const where = c.level === 'unit' ? '' : `${c.level} `
    if (o?.selection?.mode === 'none' && o.selection.reason.startsWith('held')) continue // level-held says why
    const carrying = (x) => (x?.tests ?? []).filter((t) => carries(t, c.qid))
    const m = carrying(o)
    for (const t of m) named.add(t)
    if (!o || !ran(o)) {
      bad('case-untested', `${c.qid}: the ${c.level} tests did not run${o ? ` (${o.selection.reason})` : ': the project has no such level'}`)
      continue
    }
    if (m.length === 0) {
      const elsewhere = [...outcomes].filter(([level, x]) => level !== c.level && carrying(x).length).map(([level]) => level)
      if (elsewhere.length) bad('case-level', `${c.qid} is a ${c.level} case; only a ${elsewhere.join(' and ')} test carries it`)
      else bad('case-untested', `${c.qid}: no ${where}test carries it: ${c.title}`)
    } else if (m.some(red)) {
      const r = m.find(red)
      bad('case-failed', `${c.qid}: ${r.classname} > ${r.name} ${r.status}${r.message ? `: ${r.message}` : ''}`)
    } else if (m.every((t) => t.status === 'skipped')) bad('case-skipped', `${c.qid}: every test carrying it was skipped`)
  }
}

/** The plan tier (36-test-levels.md): every level's tests after build-all's last task against its baseline, no record. A level
 * that ran nothing, the unit one when every round ran it in full, says nothing. Every finding `error` but `suite-baseline` (info)
 * and `baseline-dirty` (warning). */
export function checkRegression({ final, baseline, levelOutcomes = [], levelBaselines = [] }) {
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  const baselines = new Map(levelBaselines.map((o) => [levelOf(o), o]))
  for (const [o, base] of [[final, baseline], ...levelOutcomes.map((o) => [o, baselines.get(levelOf(o))])]) {
    if (!ran(o)) continue
    const prefix = levelOf(o) === 'unit' ? '' : `${levelOf(o)}: `
    if ((o.tests ?? []).length === 0) bad('suite-empty', empty(o, prefix))
    else suiteFindings(o, base, new Set(), prefix, bad, findings)
  }
  return findings
}

const verdictThresholds = { p0: 100, p1: 90, p1Concerns: 80, overall: 80 }
/** The TestReport of one built Plan (39-test-process.md): each case's result in the plan tier's outcome of its level, a coverage
 * status per scenario and requirement, Xray's (`ok`, `nok`, `notrun`, `uncovered`), and the verdict by BMAD's trace thresholds,
 * the rule that gave it named. `tasks`: the Plan tasks built; a case only an unbuilt one verifies is `notrun` and out of the
 * verdict. `final` is the unit outcome, `finals` the other levels'; `records` maps an AcceptanceRecord id to
 * its content; `evaluation` is the Auditor's, carried as it is; `ids`: {plan, spec, testDesign}. */
export function buildReport({ plan, tasks, spec, architecture, testDesign, final, finals = [], records = {}, evaluation, thresholds = {}, ids = {} }) {
  const t = { ...verdictThresholds, ...thresholds }
  const outcomes = new Map([...(final ? [['unit', final]] : []), ...finals.map((o) => [levelOf(o), o])])
  const of = (ids) => new Set(ids.flatMap((taskId) => taskCases({ plan, taskId, spec, testDesign }).map((c) => c.qid)))
  const built = of(tasks ?? []), unbuilt = tasks ? of((plan?.tasks ?? []).map((x) => x.id).filter((x) => !tasks.includes(x))) : new Set()
  const cases = (testDesign?.cases ?? []).map((c) => {
    const qid = qualified(spec, c.id)
    if (!built.has(qid) && unbuilt.has(qid)) return { case: qid, level: c.level, priority: c.priority, execution: c.execution, tests: [], status: 'notrun', reason: 'task not built' }
    const o = outcomes.get(c.level)
    const tests = (o?.tests ?? []).filter((x) => carries(x, qid)).map((x) => ({ name: `${x.classname} > ${x.name}`, status: x.status }))
    const row = { case: qid, level: c.level, priority: c.priority, execution: c.execution, tests }
    if (c.execution === 'manual') return { ...row, status: 'notrun', reason: 'manual' }
    if (!o || !ran(o)) return { ...row, status: 'notrun', reason: `the ${c.level} tests did not run` }
    if (tests.length === 0) return { ...row, status: 'notrun', reason: 'no test carries it' }
    if (tests.some(red)) return { ...row, status: 'nok' }
    if (tests.every((x) => x.status === 'skipped')) return { ...row, status: 'notrun', reason: 'every test carrying it was skipped' }
    return { ...row, status: 'ok' }
  })
  const status = new Map(cases.map((c) => [c.case, c.status]))
  const provenAt = new Map((architecture?.qualityScenarios ?? []).map((q) => [q.id, q.provenAt]))
  const verifying = (ref) => (testDesign?.cases ?? []).filter((c) => (c.verifies ?? []).includes(ref)).map((c) => qualified(spec, c.id))
  const acs = (spec?.stories ?? []).flatMap((s) => (s.acceptance ?? []).map((a) => a.id))
  const qss = (spec?.qualities ?? []).map((q) => q.scenario).filter((q) => provenAt.get(q) === 'build' || verifying(q).length)
  const frs = (spec?.requirements ?? []).map((r) => r.id)
  const brs = [...new Set([...(spec?.requirements ?? []).flatMap((r) => r.rules ?? []), ...(testDesign?.cases ?? []).flatMap((c) => (c.verifies ?? []).filter((v) => v.startsWith('BR-')))])]
  const coverage = [...acs, ...qss, ...frs, ...brs].map((ref) => {
    const by = verifying(ref)
    const s = by.map((q) => status.get(q))
    return { ref, status: !by.length ? 'uncovered' : s.includes('nok') ? 'nok' : s.includes('notrun') ? 'notrun' : 'ok', cases: by }
  })
  const judged = cases.filter((c) => c.reason !== 'task not built')
  const rate = (list) => (list.length ? Math.round((list.filter((c) => c.status === 'ok').length / list.length) * 1000) / 10 : 100)
  const [p0, p1, all] = [rate(judged.filter((c) => c.priority === 'P0')), rate(judged.filter((c) => c.priority === 'P1')), rate(judged)]
  const nok = cases.filter((c) => c.status === 'nok').map((c) => c.case)
  const gap = coverage.filter((c) => c.status === 'uncovered' && (c.ref.startsWith('AC-') || provenAt.get(c.ref) === 'build')).map((c) => c.ref)
  const rates = `P0 ${p0}%, P1 ${p1}%, all ${all}% ok`
  const [result, rule] =
    nok.length ? ['fail', `${nok.join(', ')} nok`]
      : gap.length ? ['fail', `${gap.join(', ')} uncovered`]
        : p0 < t.p0 ? ['fail', `${rates}: P0 below ${t.p0}%`]
          : p1 < t.p1Concerns ? ['fail', `${rates}: P1 below ${t.p1Concerns}%`]
            : all < t.overall ? ['fail', `${rates}: all cases below ${t.overall}%`]
              : p1 < t.p1 ? ['concerns', `${rates}: P1 below ${t.p1}%`]
                : ['pass', rates]
  const head = [...outcomes.values()].find((o) => o.head)?.head
  return {
    plan: ids.plan, spec: ids.spec, testDesign: ids.testDesign, ...(head ? { head } : {}),
    verdict: { result, rule, thresholds: t },
    cases,
    coverage,
    levels: [...outcomes].map(([level, o]) => ({ level, selection: o.selection?.mode ?? 'full', passed: o.tests.filter((x) => x.status === 'passed').length, failed: o.tests.filter(red).length, skipped: o.tests.filter((x) => x.status === 'skipped').length })),
    defects: Object.entries(records).flatMap(([record, r]) => (r?.defects ?? []).map((d) => ({ record, defect: d.id, observed: d.observed }))),
    evaluation,
  }
}

/** The unit level's minimums over the Change set, as its outcome records them (36-test-levels.md). */
function measures(unit, bad) {
  const c = unit?.coverage
  if (c?.error) bad('coverage-unread', `coverage not measured: ${c.error}`)
  else if (c?.total && (c.covered / c.total) * 100 < c.min) {
    bad('coverage-low', `${Math.floor((c.covered / c.total) * 1000) / 10}% of ${c.total} changed lines covered, below ${c.min}%; uncovered: ${(c.uncovered ?? []).map((u) => `${u.file}:${u.lines}`).join('; ')}`)
  }
  const m = unit?.mutation
  if (m?.error) bad('mutation-exit', `mutation not measured: ${m.error}`)
  else if (m?.score !== undefined && m.score < m.min) {
    bad('mutation-low', `mutation score ${m.score}% on the changed lines, below ${m.min}%; survivors: ${(m.survivors ?? []).map((s) => `${s.file}:${s.line} ${s.mutator}`).join('; ')}`)
  }
}

/** One Architecture against the Prd it serves, the BoundedContexts, DomainModels and Glossaries it lists (artifact ids given by
 * `ids`, paired from the artifacts inputs), the BusinessRules the Prd cites and the Adrs it applies (31-architecture-process.md).
 * `ids`: {prd, contexts[], domainModels[], glossaries[], adrs[]}; `adrs` maps an Adr id to its content, `contexts` a BoundedContext
 * id to its content. Every finding `error`. */
export function checkArchitecture({ architecture, prd, rules, ids = {}, adrs = {}, contexts: contextDocs = {} }) {
  if (!architecture || !Array.isArray(architecture.buildingBlocks) || !architecture.introduction) {
    return [{ severity: 'error', code: 'not-an-architecture', message: 'content is not an Architecture: it has no buildingBlocks array or no introduction' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  rulesSource(bad, architecture, ids, { name: 'the Prd', doc: prd })
  const a = architecture

  if (ids.prd && a.introduction.prd !== ids.prd) bad('prd-mismatch', `introduction.prd ${a.introduction.prd} is not ${ids.prd}, the Prd evaluated`)
  const contexts = new Set(ids.contexts ?? [])
  const blocks = new Map(a.buildingBlocks.map((b) => [b.id, b]))
  const partners = new Set((a.context?.business ?? []).map((p) => p.partner))
  const goals = new Set((a.introduction.qualityGoals ?? []).map((g) => g.id))
  const constraints = new Set((a.constraints ?? []).map((c) => c.id))
  const scenarios = new Set((a.qualityScenarios ?? []).map((q) => q.id))

  // contexts: every block context is one given; every given context is realised by a level 1 block; the Prd names none outside them
  const realised = new Set()
  for (const b of a.buildingBlocks) {
    if (b.parent && !blocks.has(b.parent)) bad('unknown-parent', `${b.id}: parent ${b.parent} is not a building block`)
    if (!b.parent && !String(b.technology ?? '').trim()) bad('technology-missing', `${b.id}: a level 1 block names its technology, the language, framework or store it runs on`)
    for (const c of b.contexts ?? []) {
      if (!contexts.has(c)) bad('unknown-context', `${b.id}: context ${c} is not among the BoundedContexts evaluated`)
      else if (!b.parent) realised.add(c)
    }
  }
  for (const c of contexts) if (!realised.has(c)) bad('context-unrealised', `context ${c} is realised by no level 1 building block`)
  // every capability lives in exactly one BoundedContext, the one that lists it (34-subdomains.md); the Prd names none, so
  // no context evaluated leaves every capability unplaced
  for (const cap of prd?.capabilities ?? []) {
    const homes = Object.entries(contextDocs).filter(([, c]) => (c?.capabilities ?? []).includes(cap.id)).map(([id]) => id)
    if (homes.length === 0) bad('capability-unplaced', `capability ${cap.id} is listed by no BoundedContext evaluated`)
    else if (homes.length > 1) bad('capability-twice', `capability ${cap.id} is listed by ${homes.join(' and ')}; one context handles its commands`)
  }
  // context.business[].context may name a context of another Namespace or one not yet written (23-pack-sdlc.md): not checked

  // the lists of kinds applied equal what was evaluated
  const same = (code, name, listed, given) => {
    for (const id of listed) if (!given.includes(id)) bad(code, `${name} ${id} is not among the ${name}s evaluated`)
    for (const id of given) if (!listed.includes(id)) bad(code, `${name} ${id} was evaluated but is not listed`)
  }
  same('model-mismatch', 'domainModel', a.domainModels ?? [], ids.domainModels ?? [])
  same('glossary-mismatch', 'glossary', a.glossaries ?? [], ids.glossaries ?? [])
  // the Adrs applied are the accepted ones evaluated; a superseded one is a dropped strategy's slot, evaluated but not listed
  const applied = (ids.adrs ?? []).filter((id) => adrs[id]?.status !== 'superseded')
  same('adr-mismatch', 'adr', a.decisions ?? [], applied) // how many: the kind rule says "detail is an Adr", not one per S-n; the architect loop's one-per-S-n is a prompt convention the human reads

  // strategy, scenarios, relations resolve inside the document
  for (const s of a.strategy ?? []) for (const id of s.addresses ?? []) if (!goals.has(id) && !constraints.has(id)) bad('unknown-driver', `${s.id}: addresses ${id}, neither a quality goal nor a constraint`)
  const covered = new Set()
  for (const q of a.qualityScenarios ?? []) {
    covered.add(q.qualityGoal)
    if (!goals.has(q.qualityGoal)) bad('unknown-quality-goal', `${q.id}: quality goal ${q.qualityGoal} is not in the introduction`)
  }
  for (const g of goals) if (!covered.has(g)) bad('goal-unscenarioed', `quality goal ${g} has no quality scenario`)
  const related = new Set()
  for (const r of a.relations ?? []) {
    const ends = [r.from, r.to]
    for (const e of ends) if (!blocks.has(e) && !partners.has(e)) bad('unknown-relation-end', `${r.id}: ${e} is neither a building block nor a partner`)
    if (!ends.some((e) => blocks.has(e))) bad('relation-no-block', `${r.id}: neither end is a building block`)
    for (const e of ends) related.add(e)
    if (r.interface && (blocks.has(r.to) || partners.has(r.to))) {
      const provider = blocks.has(r.to) ? blocks.get(r.to) : blocks.get(r.from) // `to` a partner: the `from` block requires it
      const kind = blocks.has(r.to) ? 'provides' : 'requires'
      if (provider && !(provider.interfaces ?? []).some((i) => i.name === r.interface && i.kind === kind)) bad('unknown-interface', `${r.id}: ${provider.id} ${kind} no interface ${r.interface}`)
    }
  }
  for (const b of a.buildingBlocks) if (!b.parent && !related.has(b.id)) bad('block-unrelated', `${b.id} has no relation`)
  for (const p of partners) if (!related.has(p)) bad('partner-unrelated', `partner ${p} has no relation`)

  // the Adrs applied: accepted, their drivers resolve in what the Architecture, the Prd and the rules name
  const ruleIds = new Set((rules?.rules ?? []).map((r) => r.id))
  const prdIds = new Set([...(prd?.goals ?? []), ...(prd?.capabilities ?? []), ...(prd?.successCriteria ?? [])].map((x) => x.id))
  const strategies = new Set((a.strategy ?? []).map((s) => s.id))
  // the slot rule (31-architecture-process.md): the n-th Adr of the list backs S-n, says so in `strategy`, and a dropped
  // strategy's slot is a superseded Adr still naming it; so an id names one decision across rounds and the Validator can
  // tell. An Adr without `strategy` (taken outside the loop) is not held to a slot. No count check: an Architecture may
  // apply fewer Adrs than it has strategies.
  const order = ids.adrs?.length ? ids.adrs : Object.keys(adrs)
  for (const [i, id] of order.entries()) {
    const adr = adrs[id]
    if (!adr) continue
    const slot = `S-${i + 1}`
    if (adr.status === 'superseded') {
      if (adr.strategy !== undefined && strategies.has(adr.strategy)) bad('adr-strategy', `adr ${id} is superseded but ${adr.strategy} is still a strategy decision of the Architecture`)
      continue
    }
    if (adr.status !== 'accepted') bad('adr-status', `adr ${id} is ${adr.status}, not accepted`)
    if (adr.strategy !== undefined) {
      if (adr.strategy !== slot) bad('adr-strategy', `adr ${id} is the Adr in slot ${i + 1} and names ${adr.strategy}; the n-th Adr backs ${slot}`)
      else if (!strategies.has(adr.strategy)) bad('adr-strategy', `adr ${id}: strategy ${adr.strategy} is not a strategy decision of the Architecture`)
    }
    for (const d of adr.drivers ?? []) if (!goals.has(d) && !constraints.has(d) && !scenarios.has(d) && !ruleIds.has(d) && !prdIds.has(d)) bad('unknown-adr-driver', `adr ${id}: driver ${d} resolves in neither the Architecture, the Prd nor the rules`)
    // a test holds the decision only at build: a Plan task proves a build scenario, and every later Gate keeps it green (suite-failed)
    for (const q of adr.enforcedBy ?? []) {
      const s = (a.qualityScenarios ?? []).find((x) => x.id === q)
      if (!s) bad('adr-enforcer', `adr ${id}: enforcedBy ${q} is not a quality scenario of the Architecture`)
      else if (s.provenAt !== 'build') bad('adr-enforcer', `adr ${id}: enforcedBy ${q} is proven at ${s.provenAt}, not at build`)
    }
  }

  sequence(bad, 'QG', [...goals])
  sequence(bad, 'C', [...constraints])
  sequence(bad, 'S', (a.strategy ?? []).map((s) => s.id))
  sequence(bad, 'BB', [...blocks.keys()])
  sequence(bad, 'REL', (a.relations ?? []).map((r) => r.id))
  sequence(bad, 'CC', (a.concepts ?? []).map((c) => c.id))
  sequence(bad, 'QS', [...scenarios])
  sequence(bad, 'RK', (a.risks ?? []).map((r) => r.id))
  return findings
}
