// One Spec of the AI Native pack against the artifacts it cites (23-pack-ai-native.md): the Prd capability, the
// DomainModel's names, the Architecture's quality scenarios, the BusinessRules. Plain data in, findings out.
const keyword = { ubiquitous: 'The', 'event-driven': 'When', 'state-driven': 'While', 'unwanted-behaviour': 'If', optional: 'Where' }

export function checkSpec({ spec, prd, domainModel, architecture, rules }) {
  if (!spec || !Array.isArray(spec.stories) || !spec.capability) {
    return [{ severity: 'error', code: 'not-a-spec', message: 'content is not a Spec: it has no stories array or no capability' }]
  }
  const findings = []
  const bad = (code, message) => findings.push({ severity: 'error', code, message })

  const capability = (prd?.capabilities ?? []).find((c) => c.id === spec.capability)
  if (!capability) bad('unknown-capability', `capability ${spec.capability} is not a capability of the Prd`)
  else if (domainModel?.context !== capability.context) {
    bad('context-mismatch', `the DomainModel's context ${domainModel?.context} is not ${capability.id}'s context ${capability.context}`)
  }

  const aggregates = domainModel?.aggregates ?? []
  const external = domainModel?.externalSystems ?? []
  const commands = new Set([...aggregates.flatMap((a) => a.commands ?? []), ...external.flatMap((e) => e.handles ?? []), ...external.flatMap((e) => e.issues ?? [])])
  const events = new Set((domainModel?.events ?? []).map((e) => e.name))
  const readModels = new Set((domainModel?.readModels ?? []).map((r) => r.name))
  const scenarios = new Set((architecture?.qualityScenarios ?? []).map((q) => q.id))
  const status = new Map((rules?.rules ?? []).map((r) => [r.id, r.status]))
  const users = new Set((prd?.users ?? []).map((u) => u.name))

  const tested = new Set()
  const storyIds = []
  const criterionIds = []
  for (const story of spec.stories) {
    storyIds.push(story.id)
    if (!users.has(story.actor)) bad('unknown-actor', `${story.id}: actor ${story.actor} is not a Prd user`)
    for (const c of story.commands ?? []) if (!commands.has(c)) bad('unknown-command', `${story.id}: command ${c} is not in the DomainModel`)
    for (const e of story.events ?? []) if (!events.has(e)) bad('unknown-event', `${story.id}: event ${e} is not in the DomainModel`)
    for (const r of story.readModels ?? []) if (!readModels.has(r)) bad('unknown-read-model', `${story.id}: read model ${r} is not in the DomainModel`)
    for (const ac of story.acceptance ?? []) {
      criterionIds.push(ac.id)
      for (const r of ac.rules ?? []) {
        tested.add(r)
        if (!status.has(r)) bad('unknown-rule', `${ac.id}: rule ${r} is not in the BusinessRules`)
        else if (status.get(r) !== 'active') bad('inactive-rule', `${ac.id}: rule ${r} is ${status.get(r)}, not active`)
      }
      const statement = String(ac.statement ?? '')
      const opens = statement.trim().split(/\s+/)[0]
      if (ac.pattern === 'complex') {
        const clauses = statement.match(/\b(while|when|if)\b/gi) ?? []
        if (!['While', 'When', 'If'].includes(opens) || clauses.length < 2) {
          bad('pattern-mismatch', `${ac.id}: a complex statement opens with While, When or If and holds two such clauses`)
        }
      } else if (keyword[ac.pattern] && opens !== keyword[ac.pattern]) {
        bad('pattern-mismatch', `${ac.id}: a ${ac.pattern} statement opens with ${keyword[ac.pattern]}`)
      }
    }
  }
  for (const r of capability?.rules ?? []) {
    if (!tested.has(r)) bad('rule-untested', `rule ${r} of ${capability.id} is tested by no acceptance criterion`)
  }
  for (const q of spec.qualities ?? []) if (!scenarios.has(q.scenario)) bad('unknown-scenario', `scenario ${q.scenario} is not in the Architecture`)

  // unique and sequential from 1 in document order: a duplicate or a gap breaks the run
  const sequence = (prefix, ids) => ids.forEach((id, i) => { if (id !== `${prefix}-${i + 1}`) bad('id-sequence', `${id} should be ${prefix}-${i + 1}`) })
  sequence('US', storyIds)
  sequence('AC', criterionIds)
  sequence('Q', (spec.openQuestions ?? []).map((q) => q.id))
  return findings
}
