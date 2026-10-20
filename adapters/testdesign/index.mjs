// testdesign/v1: what a script Task of the Test process answers, computed from the TestDesign (39-test-process.md). A Task
// with a `cases` output gets the build round's cases by level and whether the Tester writes this round (`selectCases`); one
// with a `report` output gets the built Plan's TestReport (`buildReport`). It runs no program: `prepare` reads the artifacts
// bound through the Engine's getArtifact and answers, as junit/v1 does for a level it selects out.
import { AdapterError, serve } from '../lib/agent.mjs'
import { buildReport, selectCases } from '../sdd/check.mjs'

const percent = { type: 'number', minimum: 0, maximum: 100 }

serve({
  adapterId: 'testdesign/v1',
  executorTypes: ['script'],
  contextKinds: [],
  skillFormats: [],
  configurationSchema: { type: 'object', additionalProperties: false, properties: { thresholds: { type: 'object', additionalProperties: false, description: 'the TestReport verdict: P0, P1 and all cases ok, percent', properties: { p0: percent, p1: percent, p1Concerns: percent, overall: percent } } } },
  parametersSchema: { type: 'object', additionalProperties: false, properties: {} },
  command: () => {
    throw new AdapterError('invalid_input', 'testdesign/v1 runs no program', false)
  },
  input: () => '',
  async prepare({ configuration: c, payload, call }) {
    const inputs = payload.inputs ?? {}
    const one = async (port) => (inputs[port]?.kind === 'artifact' ? (await call('getArtifact', inputs[port].ref)).spec.content : undefined)
    const many = (port) => Promise.all((inputs[port]?.refs ?? []).map(async (r) => [r.id, (await call('getArtifact', r)).spec.content]))
    const ports = Object.keys(payload.task.outputs)
    if (ports.includes('cases')) {
      return { outputs: { cases: selectCases({ plan: await one('plan'), taskId: inputs.taskId?.value, spec: await one('spec'), testDesign: await one('testDesign'), feedback: inputs.feedback?.value }) } }
    }
    if (ports.includes('report')) {
      const report = buildReport({
        plan: await one('plan'),
        spec: await one('spec'),
        architecture: await one('architecture'),
        testDesign: await one('testDesign'),
        final: await one('final'),
        finals: (await many('finals')).map(([, o]) => o),
        records: Object.fromEntries(await many('records')),
        evaluation: inputs.evaluation?.value,
        thresholds: c.thresholds,
        ids: { plan: inputs.plan?.ref?.id, spec: inputs.spec?.ref?.id, testDesign: inputs.testDesign?.ref?.id },
      })
      return { outputs: { report } }
    }
    throw new AdapterError('invalid_input', `testdesign/v1 answers a cases or a report output; this Task declares ${ports.join(', ')}`, false)
  },
})
