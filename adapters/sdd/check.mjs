// One Spec of the SDLC pack against the artifacts it cites (23-pack-sdlc.md, 27-spec-process.md): the Prd
// capability and its governing rules, the DomainModel's names, the Architecture's quality scenarios, the BusinessRules;
// inside the Spec, stories cover requirements and requirements enforce rules. And one Prd against the BusinessRules of
// its context. And one Design against the Architecture block it belongs to, the DomainModel its elements realise and the
// BusinessRules it enforces. And one Plan against its Spec, the Architecture and the Designs it realises. And one Architecture
// against the Prd, the contexts, models and glossaries it lists and the Adrs it applies. Plain data in, findings out.
// the document a Design of each type carries
import { bareSql, contractNames, designSystemNames, uiParts } from './contract.mjs'

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

export function checkSpec({ spec, prd, domainModel, architecture, rules, ids = {} }) {
  if (!spec || !Array.isArray(spec.stories) || !Array.isArray(spec.requirements) || !spec.capability) {
    return [{ severity: 'error', code: 'not-a-spec', message: 'content is not a Spec: it has no stories array, no requirements array or no capability' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })
  rulesSource(bad, spec, ids, { name: 'the Prd', doc: prd })

  const capability = (prd?.capabilities ?? []).find((c) => c.id === spec.capability)
  if (!capability) bad('unknown-capability', `capability ${spec.capability} is not a capability of the Prd`)
  // derive-domain names the BoundedContext after the storming context, so the model's context is the capability's
  else if (domainModel?.context !== capability.context) bad('context-mismatch', `${capability.id}: context ${capability.context} is not ${domainModel?.context}, the context of the DomainModel`)

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
  const criterionIds = []
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
    for (const ac of story.acceptance ?? []) criterionIds.push(ac.id)
  }
  for (const id of requirementIds) if (!covered.has(id)) bad('requirement-uncovered', `requirement ${id} is covered by no story`)
  for (const r of capability?.rules ?? []) {
    if (!enforced.has(r)) bad('rule-unenforced', `rule ${r} governs ${capability.id} but no requirement enforces it`)
  }
  for (const q of spec.qualities ?? []) if (!scenarios.has(q.scenario)) bad('unknown-scenario', `scenario ${q.scenario} is not in the Architecture`)

  sequence(bad, 'FR', requirementIds)
  sequence(bad, 'US', storyIds)
  sequence(bad, 'AC', criterionIds)
  sequence(bad, 'Q', (spec.openQuestions ?? []).map((q) => q.id))
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
  const ruleContext = new Map((rules?.rules ?? []).map((r) => [r.id, r.context]))
  // one BusinessRules per product (33-multi-context-product.md): a capability lives in one of its contexts and cites rules
  // of that context, or untagged ones; with several contexts every rule says which one enforces it
  const contexts = rules?.contexts ?? []
  if (contexts.length > 1) for (const r of rules.rules ?? []) if (!r.context) bad('context-mismatch', `${r.id}: a product over ${contexts.length} contexts tags every rule with the context that enforces it`)
  for (const r of rules?.rules ?? []) if (r.context && !contexts.includes(r.context)) bad('context-mismatch', `${r.id}: context ${r.context} is not one the BusinessRules govern (${contexts.join(', ')})`)
  const capabilityIds = prd.capabilities.map((c) => c.id)
  for (const cap of prd.capabilities) {
    for (const r of cap.rules ?? []) {
      if (!status.has(r)) bad('unknown-rule', `${cap.id}: rule ${r} is not in the BusinessRules`)
      else if (status.get(r) !== 'active') bad('inactive-rule', `${cap.id}: rule ${r} is ${status.get(r)}, not active`)
      else if (ruleContext.get(r) && ruleContext.get(r) !== cap.context) bad('context-mismatch', `${cap.id}: rule ${r} is enforced in ${ruleContext.get(r)}, not the capability's ${cap.context}`)
    }
    if (!contexts.includes(cap.context)) bad('context-mismatch', `${cap.id}: context ${cap.context} is not one the BusinessRules govern (${contexts.join(', ')})`)
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
const isOperation = (name) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//.test(name)
const backticked = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
export function checkDesign({ design, architecture, domainModel, rules, designs = {}, designSystem, ids = {} }) {
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
      const screen = [...declared].find((s) => typeof el.name === 'string' && el.name.startsWith(`${s}: `))
      const op = el.realises?.name
      if (screen && typeof op === 'string' && !backticked(actionsOf(screen)).includes(op)) bad('action-unbacked', `${el.id}: ${op} is not in the Actions of ${screen}`)
    }
    const names = designSystemNames(designSystem?.document?.content)
    if (names) for (const p of parts.filter((p) => p.part === 'Layout')) for (const t of new Set(backticked(p.text))) if (!names.has(t)) warn('layout-unknown', `${p.screen}: \`${t}\` is not a component or token of the DesignSystem`)
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

// One Plan against the Spec it builds, the Architecture its tasks name blocks of, and the Designs it realises elements
// of; `designs` is artifact id → content, paired by the caller from inputs.designs.refs and artifacts.designs.
// `ids` are the bound inputs' artifact ids, `{spec, architecture}`, which a content never carries.
export function checkPlan({ plan, spec, architecture, designs = {}, ids = {} }) {
  if (!plan || !Array.isArray(plan.tasks) || !plan.spec) {
    return [{ severity: 'error', code: 'not-a-plan', message: 'content is not a Plan: it has no tasks array or no spec' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })

  const requirements = new Set((spec?.requirements ?? []).map((r) => r.id))
  const scenarios = new Set((spec?.stories ?? []).flatMap((s) => (s.acceptance ?? []).map((a) => a.id)))
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
      if (!scenarios.has(a)) bad('unknown-scenario', `${t.id}: scenario ${a} is not in the Spec`)
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
  for (const d of listed) if (!used.has(d)) bad('design-unused', `design ${d} is listed but no task realises an element of it`)

  sequence(bad, 'T', taskIds)
  sequence(bad, 'Q', (plan.openQuestions ?? []).map((q) => q.id))
  return findings
}

/** One Architecture against the Prd it serves, the BoundedContexts, DomainModels and Glossaries it lists (artifact ids given by
 * `ids`, paired from the artifacts inputs), the BusinessRules the Prd cites and the Adrs it applies (31-architecture-process.md).
 * `ids`: {prd, contexts[], domainModels[], glossaries[], adrs[]}; `adrs` maps an Adr id to its content. Every finding `error`. */
export function checkArchitecture({ architecture, prd, rules, ids = {}, adrs = {} }) {
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
    for (const c of b.contexts ?? []) {
      if (!contexts.has(c)) bad('unknown-context', `${b.id}: context ${c} is not among the BoundedContexts evaluated`)
      else if (!b.parent) realised.add(c)
    }
  }
  for (const c of contexts) if (!realised.has(c)) bad('context-unrealised', `context ${c} is realised by no level 1 building block`)
  // context.business[].context may name a context of another Namespace or one not yet written (23-pack-sdlc.md): not checked
  for (const cap of prd?.capabilities ?? []) if (cap.context && !contexts.has(cap.context)) bad('prd-context-unread', `capability ${cap.id}: context ${cap.context} is not among the BoundedContexts evaluated`)

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
