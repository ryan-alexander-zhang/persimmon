// One Spec of the AI Native pack against the artifacts it cites (23-pack-ai-native.md, 27-spec-process.md): the Prd
// capability and its governing rules, the DomainModel's names, the Architecture's quality scenarios, the BusinessRules;
// inside the Spec, stories cover requirements and requirements enforce rules. And one Prd against the BusinessRules of
// its context. Plain data in, findings out.
const keyword = { ubiquitous: 'The', 'event-driven': 'When', 'state-driven': 'While', 'unwanted-behaviour': 'If', optional: 'Where' }

// unique and sequential from 1 in document order: a duplicate or a gap breaks the run
const sequence = (bad, prefix, ids) => ids.forEach((id, i) => { if (id !== `${prefix}-${i + 1}`) bad('id-sequence', `${id} should be ${prefix}-${i + 1}`) })

export function checkSpec({ spec, prd, domainModel, architecture, rules }) {
  if (!spec || !Array.isArray(spec.stories) || !Array.isArray(spec.requirements) || !spec.capability) {
    return [{ severity: 'error', code: 'not-a-spec', message: 'content is not a Spec: it has no stories array, no requirements array or no capability' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })

  const capability = (prd?.capabilities ?? []).find((c) => c.id === spec.capability)
  if (!capability) bad('unknown-capability', `capability ${spec.capability} is not a capability of the Prd`)
  // domainModel.context is not compared with the capability's: a derived model names the storming context, the Prd the
  // BoundedContext artifact, until a producer may choose an artifact id (91-roadmap.md)

  const aggregates = domainModel?.aggregates ?? []
  const external = domainModel?.externalSystems ?? []
  const commands = new Set([...aggregates.flatMap((a) => a.commands ?? []), ...external.flatMap((e) => e.handles ?? []), ...external.flatMap((e) => e.issues ?? [])])
  // another context's event reaches the model only as a read model's updatedBy or an external system's emits
  const events = new Set([...(domainModel?.events ?? []).map((e) => e.name), ...(domainModel?.readModels ?? []).flatMap((r) => r.updatedBy ?? []), ...external.flatMap((e) => e.emits ?? [])])
  const readModels = new Set((domainModel?.readModels ?? []).map((r) => r.name))
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

export function checkPrd({ prd, rules }) {
  if (!prd || !Array.isArray(prd.capabilities) || !prd.title) {
    return [{ severity: 'error', code: 'not-a-prd', message: 'content is not a Prd: it has no capabilities array or no title' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })

  const status = new Map((rules?.rules ?? []).map((r) => [r.id, r.status]))
  const capabilityIds = prd.capabilities.map((c) => c.id)
  for (const cap of prd.capabilities) {
    for (const r of cap.rules ?? []) {
      if (!status.has(r)) bad('unknown-rule', `${cap.id}: rule ${r} is not in the BusinessRules`)
      else if (status.get(r) !== 'active') bad('inactive-rule', `${cap.id}: rule ${r} is ${status.get(r)}, not active`)
    }
    // the BusinessRules artifact is one per context, and a run checks one context
    if (cap.context !== rules?.context) bad('context-mismatch', `${cap.id}: context ${cap.context} is not ${rules?.context}, the context of the BusinessRules`)
  }
  for (const sc of prd.successCriteria ?? []) {
    for (const c of sc.capabilities ?? []) if (!capabilityIds.includes(c)) bad('unknown-capability', `${sc.id}: capability ${c} is not in the Prd`)
  }
  // a number belongs to a success criterion
  for (const g of prd.goals ?? []) if (/\d/.test(String(g.statement ?? ''))) bad('goal-with-number', `${g.id}: a goal states a direction without a number`)

  sequence(bad, 'G', (prd.goals ?? []).map((g) => g.id))
  sequence(bad, 'CAP', capabilityIds)
  sequence(bad, 'SC', (prd.successCriteria ?? []).map((s) => s.id))
  sequence(bad, 'Q', (prd.openQuestions ?? []).map((q) => q.id))
  return findings
}
