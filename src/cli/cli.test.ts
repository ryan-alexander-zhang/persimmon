import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, parseAllDocuments, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseInput } from './create.js'
import { askForm, example as template, fromFile, type Form } from './signal.js'
import { runCli } from './index.js'
import { init, packDir } from './init.js'
import { digestOf } from '../snapshot/canonical.js'
import { loadConfig } from '../config.js'
import { Engine } from '../engine.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const demoPack = ['10-artifact-kinds', '20-relation-types', '30-prompts', '40-executors', '50-tasks', '60-validators', '70-gates', '80-workflows'].map((f) => `packs/demo/global/${f}.yaml`)
const sdlcPack = ['10-artifact-kinds', '30-prompts', '40-executors', '50-tasks', '60-validators', '70-gates', '80-workflows'].map((f) => `packs/sdlc/global/${f}.yaml`)
const fakeAdapter = (id: string, types = 'agent,script') => ({
  apiVersion: 'persimmon.ai/v1', kind: 'Adapter', metadata: { name: id.replace('/', '-') },
  spec: { id, roles: ['executor'], transport: 'stdio', command: ['node', join(process.cwd(), 'test/fixtures/fake-adapter.mjs')], env: { FAKE_ID: id, FAKE_TYPES: types } },
})

describe('persimmon CLI', () => {
  let dir: string
  let out: string[]
  let err: string[]
  const run = (...argv: string[]) => runCli(argv, { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
  const file = (name: string, docs: unknown[]) => {
    const p = join(dir, name)
    writeFileSync(p, docs.map((d) => stringify(d)).join('---\n'))
    return p
  }
  /** init, then the demo pack by hand: its prd-create and Trigger are what the run tests drive */
  const initDemo = async () => {
    await run('init')
    await run('apply', ...demoPack, '--global')
    await run('apply', 'packs/demo/namespaced/on-prd-published.yaml', '-n', 'default')
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-cli-'))
    out = []
    err = []
    process.env.PERSIMMON_CRED_GITHUB_TOKEN = 'ghp-test'
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('init writes config and applies the SDLC pack; the demo pack applies by hand; validate and apply report per Resource', async () => {
    expect([await run('init'), err]).toEqual([0, []])
    expect(out[0]).toBe('wrote persimmon.yaml')
    expect(out.filter((l) => l.startsWith('created')).length).toBeGreaterThanOrEqual(14)
    expect(out.filter((l) => l.startsWith('warn'))).toEqual([]) // every pack Executor's Adapter ships
    expect(out).toContain('created Pipeline/domain-discovery') // the SDLC pack (23-pack-sdlc.md) is the default flow
    out = []
    expect(await run('get', 'Workflow')).toBe(0)
    expect(out).toEqual(['Workflow/build-all', 'Workflow/build-work', 'Workflow/derive-all', 'Workflow/design-all', 'Workflow/design-check', 'Workflow/design-coverage', 'Workflow/plan-all', 'Workflow/spec-all']) // the pack is Global (20-pack.md)
    out = [] // the demo pack (20-pack.md) applies like any user definitions: global/ as Global, its Trigger into the default Namespace
    expect([await run('apply', ...demoPack, '--global'), out.filter((l) => !l.startsWith('created'))]).toEqual([0, ['unchanged Executor/local-reviewer']]) // same definition in both packs
    out = []
    expect([await run('apply', 'packs/demo/namespaced/on-prd-published.yaml', '-n', 'default'), out]).toEqual([0, ['created Trigger/on-prd-published']]) // the pack's Trigger listens in defaultNamespace
    out = []
    expect([await run('init'), err]).toEqual([0, []]) // idempotent
    expect(out.every((l) => !l.startsWith('created'))).toBe(true)

    expect(await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1'), fakeAdapter('cli-human/v1', 'human')]))).toBe(0)
    out = []
    expect(await run('adapter', 'list')).toBe(0)
    expect(out).toEqual(['claude-code/v1  Ready  roles: executor', 'cli-human/v1  Ready  roles: executor', 'codex/v1  Ready  roles: executor', 'designmd/v1  Ready  roles: evaluator', 'eventstorming/v1  Ready  roles: evaluator', 'junit/v1  Ready  roles: executor', 'sdd/v1  Ready  roles: evaluator', 'subprocess/v1  Ready  roles: executor'])

    out = []
    expect([await run('validate', 'packs/demo/global/50-tasks.yaml', 'packs/demo/global/80-workflows.yaml', 'packs/demo/global/40-executors.yaml'), out.filter((l) => l.startsWith('error'))]).toEqual([0, []])
    expect(out.filter((l) => l.startsWith('ok')).length).toBeGreaterThanOrEqual(7)
    out = [] // the SDLC pack's worked domain example validates (23-pack-sdlc.md)
    expect([await run('validate', 'docs/design/examples/sdlc-domain.yaml'), out.filter((l) => !l.startsWith('ok'))]).toEqual([0, []])
    expect(out.length).toBe(17)
    out = [] // the pack's own live output, meeting room booking, validates too
    expect([await run('validate', 'examples/example07/room-booking-domain.yaml'), out.filter((l) => !l.startsWith('ok'))]).toEqual([0, []])
    expect(out.length).toBe(30)
    out = [] // and the Issue its build stage writes (examples/example07/README.md step 10)
    expect([await run('validate', 'examples/example07/issue.yaml', 'examples/example07/issue-resolved.yaml'), out]).toEqual([0, ['ok    Issue/back-to-back-booking-refused.r1', 'ok    Issue/back-to-back-booking-refused.r2']])
    out = [] // the car pool over two contexts (33-multi-context-product.md)
    expect([await run('validate', 'examples/example08/car-pool-domain.yaml'), out.filter((l) => !l.startsWith('ok'))]).toEqual([0, []])
    expect(out.length).toBe(36)
    out = []
    const bad = example('workflow-prd-create')
    bad.spec.entry = ['write-prd']
    expect(await run('validate', file('bad.yaml', [bad]))).toBe(1)
    expect(out.some((l) => l.startsWith('error Workflow/prd-create') && l.includes('entry must equal'))).toBe(true)
    // a Workflow in a file sees the project's Namespaced Tasks, as apply would place it (checker stamps the default Namespace)
    const nsTask = { ...parse(readFileSync('packs/demo/global/50-tasks.yaml', 'utf8').split('---')[0]!), metadata: { name: 'research-local' } }
    expect(await run('apply', file('ns-task.yaml', [nsTask]))).toBe(0)
    const local = { ...example('workflow-prd-create'), metadata: { name: 'local-create' } }
    local.spec.steps[0].uses = { kind: 'Task', name: 'research-local' }
    out = []
    expect([await run('validate', file('local.yaml', [local])), out.filter((l) => l.startsWith('error'))]).toEqual([0, []])
    expect(await run('delete', 'Task/research-local')).toBe(0) // validate stored nothing; the counts below see the pack only

    // describe-driven Task rules: parameters, context kinds, Skill formats (12-task.md)
    const codexExecutor = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'codex-agent' }, spec: { type: 'agent', adapter: 'codex/v1', configuration: { model: 'gpt-6-sol' }, security: { networkAccess: 'deny' } } }
    const skill = { apiVersion: 'persimmon.ai/v1', kind: 'Skill', metadata: { name: 'odd' }, spec: { source: { provider: 'git', type: 'repository', id: 'x', locator: { remote: 'r' }, version: 'v' }, digest: 'sha256:' + 'a'.repeat(64), format: 'other/v1' } }
    const t1 = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 't1' }, spec: { outputs: { n: { type: { kind: 'value', schema: { type: 'integer' } } } }, executorRef: { kind: 'Executor', name: 'codex-agent' }, action: { instructions: 'x', parameters: { effort: 'high' }, context: [{ kind: 'skill', ref: { kind: 'Skill', name: 'odd' } }] }, timeout: '1m', sideEffects: 'none' } }
    out = []
    expect(await run('validate', file('rules.yaml', [codexExecutor, skill, t1]))).toBe(1)
    const errors = out.filter((l) => l.startsWith('error Task/t1'))
    expect(errors.some((l) => l.includes('parameters do not match codex/v1 describe.parametersSchema'))).toBe(true)
    expect(errors.some((l) => l.includes('Skill odd format other/v1 is not in codex/v1 describe.skillFormats'))).toBe(true)
    const scriptExecutor = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'lint-script' }, spec: { type: 'script', adapter: 'subprocess/v1', configuration: { program: ['./lint.sh'], resultFile: 'result.json' }, security: { networkAccess: 'deny' } } }
    const t2 = { ...t1, metadata: { name: 't2' }, spec: { ...t1.spec, executorRef: { kind: 'Executor', name: 'lint-script' }, action: { instructions: 'x', context: [{ kind: 'prompt', ref: { kind: 'Prompt', name: 'write-prd-template' } }] } } }
    out = []
    expect(await run('validate', file('rules2.yaml', [scriptExecutor, t2]))).toBe(1)
    expect(out.some((l) => l.startsWith('error Task/t2') && l.includes('subprocess/v1 does not accept prompt context'))).toBe(true)

    out = []
    expect(await run('get', 'Task')).toBe(0)
    expect(out.length).toBe(27) // the SDLC pack's twenty-two and the demo pack's five
    expect(await run('delete', 'Task/write-prd')).toBe(1) // referenced by prd-create
    expect(err.at(-1)).toMatch(/referenced/)

    // a Namespaced override shadows the Global pack Task; refs resolve Namespace first, --global reaches the shadowed one
    const override = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'write-prd' }, spec: { ...(parse(readFileSync('packs/demo/global/50-tasks.yaml', 'utf8').split('---')[1]!).spec as object), timeout: '5m' } }
    const incompatible = structuredClone(override) as { spec: { outputs: Record<string, unknown> } }
    incompatible.spec.outputs = { other: { type: { kind: 'value', schema: { type: 'string' } } } }
    err = []
    expect(await run('apply', file('incompatible.yaml', [incompatible]), '-n', 'default')).toBe(1) // ports must match the Global definition (20-pack.md)
    expect(err.at(-1)).toMatch(/override outputs\.prd is missing/)
    out = []
    expect(await run('apply', file('override.yaml', [override]), '-n', 'default')).toBe(0)
    expect(out.at(-1)).toBe('created Task/write-prd')
    out = []
    expect(await run('get', 'Task/write-prd')).toBe(0)
    expect(out.join('\n')).toMatch(/namespace: default/)
    out = []
    expect(await run('get', 'Task/write-prd', '--global')).toBe(0)
    expect(out.join('\n')).not.toMatch(/namespace:/)
    expect(await run('delete', 'Task/write-prd', '-n', 'default')).toBe(0) // the override is unreferenced
    err = []
    out = []
    expect([await run('apply', file('ns.yaml', [{ ...override, metadata: { name: 'write-prd-2' } }]), '--global'), err, out.at(-1)]).toEqual([0, [], 'created Task/write-prd-2']) // scope Any: allowed
    expect([await run('apply', file('ns.yaml', [{ ...override, metadata: { name: 'write-prd-2' } }]), '--global'), out.at(-1)]).toEqual([0, 'unchanged Task/write-prd-2']) // same spec: no write
    out = []
    expect(await run('get', 'Task/write-prd-2')).toBe(0)
    expect(parse(out.join('\n')).metadata.resourceVersion).toBe('1')
    out = []
    expect(await run('get', 'Task/write-prd-2')).toBe(0)
    expect(out.join('\n')).not.toMatch(/namespace:/)
    // a pack upgrade: a changed Global definition is updated in place, not refused (20-pack.md upgrade)
    const upgraded = { ...override, metadata: { name: 'write-prd-2' }, spec: { ...override.spec, action: { ...override.spec.action, instructions: 'Write the PRD, briefly.' } } }
    out = []
    expect(await run('apply', file('task2-upgrade.yaml', [upgraded]), '--global')).toBe(0)
    expect(out).toEqual(['updated Task/write-prd-2'])
    out = []
    expect(await run('get', 'Task/write-prd-2')).toBe(0)
    expect(parse(out.join('\n')).metadata.generation).toBe(2)
    // an upgrade the Handler would refuse on create is refused on update too
    const broken = { ...upgraded, spec: { ...upgraded.spec, action: { ...upgraded.spec.action, context: [{ kind: 'artifact', input: 'nope' }] } } }
    err = []
    expect(await run('apply', file('task2-broken.yaml', [broken]), '--global')).toBe(1)
    expect(err.at(-1)).toMatch(/error Task\/write-prd-2: .*nope is not an input/)
    // a Namespaced override of a name the pack adds later: --global creates the Global one, the override stays
    expect(await run('apply', file('ns3.yaml', [{ ...override, metadata: { name: 'write-prd-3' } }]))).toBe(0)
    out = []
    expect(await run('apply', file('g3.yaml', [{ ...upgraded, metadata: { name: 'write-prd-3' } }]), '--global')).toBe(0)
    expect(out).toEqual(['created Task/write-prd-3'])
    out = []
    expect(await run('get', 'Task/write-prd-3', '-n', 'default')).toBe(0)
    expect(parse(out.join('\n')).spec.action.instructions).not.toBe('Write the PRD, briefly.')
    const run1 = { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'r' }, spec: { workflowRef: { kind: 'Workflow', name: 'prd-create' }, inputs: {}, timeout: '1h', origin: { kind: 'manual' } } }
    expect(await run('apply', file('run.yaml', [run1]), '--global')).toBe(1) // Namespaced kind
    expect(err.at(-1)).toMatch(/--global does not apply/)
  }, 30_000)

  it('init places the pack files when absent, links CLAUDE.md to the AGENTS.md it wrote, and ignores .persimmon/ once (20-pack.md)', async () => {
    const placed = () => out.filter((l) => /^(wrote|kept|ignored) /.test(l))
    expect([await run('init'), err]).toEqual([0, []])
    expect(placed()).toEqual(['wrote persimmon.yaml', 'wrote AGENTS.md', 'wrote CLAUDE.md -> AGENTS.md', 'ignored .persimmon/ in .gitignore'])
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(readFileSync('packs/sdlc/files/AGENTS.md', 'utf8'))
    expect(readlinkSync(join(dir, 'CLAUDE.md'))).toBe('AGENTS.md')
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('.persimmon/\n')
    out = []
    expect(await run('init')).toBe(0)
    expect(placed()).toEqual(['kept AGENTS.md']) // never overwritten, never ignored twice
  })

  it('init keeps a project\'s own AGENTS.md, links no CLAUDE.md to it, and appends to its .gitignore', async () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'mine\n')
    writeFileSync(join(dir, '.gitignore'), 'node_modules')
    expect([await run('init'), err]).toEqual([0, []])
    expect(out.filter((l) => /^(kept|ignored) /.test(l))).toEqual([`kept AGENTS.md (differs from the pack's: ${join(packDir(), 'files', 'AGENTS.md')})`, 'ignored .persimmon/ in .gitignore'])
    expect([readFileSync(join(dir, 'AGENTS.md'), 'utf8'), existsSync(join(dir, 'CLAUDE.md'))]).toEqual(['mine\n', false])
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.persimmon/\n')
  })

  it('init updates an AGENTS.md it wrote that nobody edited, keeps an edited one, and records one a fresh clone has (20-pack.md)', async () => {
    const placed = () => out.filter((l) => /^(wrote|kept|updated) AGENTS\.md/.test(l))
    const record = join(dir, '.persimmon', 'files.json')
    const pack = readFileSync('packs/sdlc/files/AGENTS.md', 'utf8')
    expect(await run('init')).toBe(0)
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual({ 'AGENTS.md': digestOf(Buffer.from(pack)) })
    writeFileSync(join(dir, 'AGENTS.md'), 'an older pack\n') // as an older init wrote it
    writeFileSync(record, JSON.stringify({ 'AGENTS.md': digestOf(Buffer.from('an older pack\n')) }))
    out = []
    expect(await run('init')).toBe(0)
    expect([placed(), readFileSync(join(dir, 'AGENTS.md'), 'utf8')]).toEqual([['updated AGENTS.md'], pack])
    writeFileSync(join(dir, 'AGENTS.md'), `${pack}mine\n`) // edited by the user
    out = []
    expect(await run('init')).toBe(0)
    expect([placed(), readFileSync(join(dir, 'AGENTS.md'), 'utf8')]).toEqual([[`kept AGENTS.md (differs from the pack's: ${join(packDir(), 'files', 'AGENTS.md')})`], `${pack}mine\n`])
    writeFileSync(join(dir, 'AGENTS.md'), pack)
    rmSync(record) // a fresh clone: the file from git, .persimmon/ ignored
    out = []
    expect(await run('init')).toBe(0)
    expect([placed(), JSON.parse(readFileSync(record, 'utf8'))]).toEqual([['kept AGENTS.md'], { 'AGENTS.md': digestOf(Buffer.from(pack)) }])
    writeFileSync(join(dir, 'other.md'), 'an older pack\n')
    rmSync(join(dir, 'AGENTS.md'))
    symlinkSync('other.md', join(dir, 'AGENTS.md'))
    writeFileSync(record, JSON.stringify({ 'AGENTS.md': digestOf(Buffer.from('an older pack\n')) }))
    out = []
    expect(await run('init')).toBe(0)
    expect([placed(), readFileSync(join(dir, 'other.md'), 'utf8')]).toEqual([['kept AGENTS.md'], 'an older pack\n']) // a live link is never written through
    for (const bad of ['{', 'null', '"x"', '[]']) {
      rmSync(join(dir, 'AGENTS.md'))
      writeFileSync(record, bad)
      out = []
      expect([await run('init'), err, placed()]).toEqual([0, [], ['wrote AGENTS.md']]) // an unreadable record is empty
    }
  })

  it('init writes AGENTS.md beside a CLAUDE.md of the project\'s and says it is not linked; a dangling link is kept; /.persimmon counts as ignored', async () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'mine\n')
    writeFileSync(join(dir, '.gitignore'), '/.persimmon\n')
    expect([await run('init'), err]).toEqual([0, []])
    expect(out.filter((l) => /^(wrote|kept|ignored) /.test(l))).toEqual(['wrote persimmon.yaml', 'wrote AGENTS.md', 'kept CLAUDE.md (not linked to AGENTS.md: claude-code agents do not read it)'])
    expect([readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), readFileSync(join(dir, '.gitignore'), 'utf8')]).toEqual(['mine\n', '/.persimmon\n'])
    rmSync(join(dir, 'AGENTS.md'))
    rmSync(join(dir, 'CLAUDE.md'))
    symlinkSync('gone.md', join(dir, 'AGENTS.md'))
    out = []
    expect(await run('init')).toBe(0)
    expect(out.filter((l) => /^(wrote|kept|ignored) /.test(l))).toEqual(['kept AGENTS.md']) // lstat: a dangling link is present, never written through
    expect(readlinkSync(join(dir, 'AGENTS.md'))).toBe('gone.md')
  })

  it('init with another pack applies its namespaced/ Triggers; the SDLC pack validates as a file set before any of it is stored', async () => {
    expect([await init({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) }, { pack: 'packs/demo' }), err]).toEqual([0, []])
    expect(out).toContain('created Trigger/on-prd-published') // the pack's Triggers listen in defaultNamespace
    expect(out.filter((l) => /^(wrote|kept|ignored) /.test(l))).toEqual(['wrote persimmon.yaml', 'ignored .persimmon/ in .gitignore']) // no files/, still ignored
    out = []
    expect(await run('get', 'Workflow')).toBe(0)
    expect(out).toEqual(['Workflow/prd-approval', 'Workflow/prd-create']) // the SDLC pack is not in this store
    out = [] // so a Workflow stepping into a ReviewLoop of the same files resolves on validate's second pass only (08-store.md)
    expect([await run('validate', ...sdlcPack), out.filter((l) => !l.startsWith('ok'))]).toEqual([0, []])
    expect(out.length).toBe(115)
  })

  it('get --behind lists the latest revision whose pinned inputs moved on; a carried previous input and a run\'s own later output are not behind', async () => {
    await run('init')
    const engine = new Engine({ config: loadConfig(join(dir, 'persimmon.yaml')), cwd: dir })
    await engine.start()
    const ref = (kind: string, id: string, revision: number, namespace = 'default') => ({ apiVersion: 'sdd.persimmon.ai/v1', kind, namespace, id, revision })
    const rev = (kind: string, id: string, revision: number, producer: string, inputs: object[] = [], namespace = 'default') => ({
      apiVersion: 'sdd.persimmon.ai/v1',
      kind,
      metadata: { name: `${id}.r${revision}`, namespace },
      spec: { identity: { id, revision }, content: {}, provenance: { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace, name: producer, uid: `uid-${namespace}-${producer}` }, inputs, actor: { kind: 'user', id: 'local' } } },
      status: { contentDigest: 'sha256:' + '0'.repeat(64), representations: [] },
    })
    const scope = { uid: 'test', key: 'k' }
    engine.store.resources.stage(rev('BusinessRules', 'rules', 1, 'rules-run-1'), scope)
    engine.store.resources.stage(rev('Spec', 'cap-1', 1, 'spec-run-1', [ref('BusinessRules', 'rules', 1)]), scope) // behind once rules r2 lands
    engine.store.resources.stage(rev('BusinessRules', 'rules', 2, 'rules-run-2'), scope)
    engine.store.resources.stage(rev('Spec', 'cap-2', 1, 'spec-run-2', [ref('BusinessRules', 'rules', 2), ref('BusinessRules', 'rules', 1)]), scope) // previousRules r1 beside rules r2: current
    engine.store.resources.stage(rev('Prd', 'prd', 2, 'prd-run-2', [ref('Prd', 'prd', 1), ref('BusinessRules', 'rules', 2)]), scope) // read rules r2, and wrote r3 in the same run
    engine.store.resources.stage(rev('BusinessRules', 'rules', 3, 'prd-run-2'), scope)
    engine.store.resources.stage(rev('Spec', 'cap-3', 1, 'spec-run-3', [ref('BusinessRules', 'rules', 1)]), scope) // behind, but not the latest revision of its id
    engine.store.resources.stage(rev('Spec', 'cap-3', 2, 'spec-run-4', [ref('BusinessRules', 'rules', 3)]), scope)
    engine.store.resources.stage(rev('Spec', 'cap-4', 1, 'spec-run-5', [ref('BusinessRules', 'rules', 2)], 'other'), scope) // in another Namespace, reading this one's rules
    engine.store.resources.stage(rev('BusinessRules', 'rules', 1, 'rules-run-2', [], 'other'), scope) // other's own rules, written by a run named like default's: not the same run
    engine.store.resources.stage(rev('Spec', 'cap-5', 1, 'spec-run-6', [ref('BusinessRules', 'rules', 1, 'other'), ref('BusinessRules', 'rules', 2)]), scope)
    engine.store.resources.stage(rev('BusinessRules', 'rules', 2, 'spec-run-6', [], 'other'), scope) // spec-run-6 of other is not spec-run-6 of default
    engine.store.resources.commitScope(scope)
    await engine.close()
    out = []
    expect([await run('get', 'Spec', '--behind'), out]).toEqual([0, ['Spec/cap-1.r1  -n default  behind BusinessRules/rules r1 → r3', 'Spec/cap-2.r1  -n default  behind BusinessRules/rules r2 → r3', 'Spec/cap-5.r1  -n default  behind BusinessRules/rules -n other r1 → r2', 'Spec/cap-5.r1  -n default  behind BusinessRules/rules r2 → r3']])
    out = []
    expect([await run('get', 'Spec', '--behind', '-n', 'other'), out]).toEqual([0, ['Spec/cap-4.r1  -n other  behind BusinessRules/rules -n default r2 → r3']])
    out = []
    expect([await run('get', 'Spec', '--behind', '--global'), out.length]).toEqual([0, 5]) // every Namespace
    out = []
    expect([await run('get', 'Prd', '--behind'), out]).toEqual([0, []]) // rules r3 came from the Prd's own run
    expect(await run('get', 'Workflow', '--behind')).toBe(1)
    expect(err.at(-1)).toBe('Workflow is not revisioned')
    expect(await run('get', 'Nope', '--behind')).toBe(1)
    expect(err.at(-1)).toBe('unknown kind Nope')
  })

  it('get --files writes every representation of a revision as <name>.<ext> into the directory', async () => {
    await run('init')
    const engine = new Engine({ config: loadConfig(join(dir, 'persimmon.yaml')), cwd: dir })
    await engine.start()
    const html = engine.store.blobs.put(Buffer.from('<h1>screens</h1>'), 'text/html')
    const svg = engine.store.blobs.put(Buffer.from('<svg/>'), 'image/svg+xml')
    const mmd = engine.store.blobs.put(Buffer.from('graph TD'), 'text/vnd.mermaid')
    const scope = { uid: 'test', key: 'k' }
    engine.store.resources.stage({
      apiVersion: 'sdd.persimmon.ai/v1', kind: 'Design', metadata: { name: 'ui.r1', namespace: 'default' },
      spec: { identity: { id: 'ui', revision: 1 }, content: {}, provenance: { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'default', name: 'run', uid: 'uid-run' }, inputs: [], actor: { kind: 'user', id: 'local' } } },
      status: { contentDigest: 'sha256:' + '0'.repeat(64), representations: [{ name: 'screens', mediaType: 'text/html', digest: html.digest }, { name: 'flow', mediaType: 'image/svg+xml', digest: svg.digest }, { name: 'decision', mediaType: 'text/vnd.mermaid', digest: mmd.digest }] },
    }, scope)
    engine.store.resources.stage({
      apiVersion: 'sdd.persimmon.ai/v1', kind: 'Design', metadata: { name: 'bare.r1', namespace: 'default' },
      spec: { identity: { id: 'bare', revision: 1 }, content: {}, provenance: { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'default', name: 'run', uid: 'uid-run' }, inputs: [], actor: { kind: 'user', id: 'local' } } },
      status: { contentDigest: 'sha256:' + '0'.repeat(64), representations: [] },
    }, scope)
    engine.store.resources.commitScope(scope)
    await engine.close()
    out = []
    expect([await run('get', 'Design/ui.r1', '--files', 'out/ui'), out]).toEqual([0, [`wrote ${join(dir, 'out/ui/screens.html')}  text/html  16 bytes`, `wrote ${join(dir, 'out/ui/flow.svg')}  image/svg+xml  6 bytes`, `wrote ${join(dir, 'out/ui/decision.mmd')}  text/vnd.mermaid  8 bytes`]])
    expect(readFileSync(join(dir, 'out/ui/screens.html'), 'utf8')).toBe('<h1>screens</h1>')
    expect(await run('get', 'Design/bare.r1', '--files', 'out/bare')).toBe(1)
    expect(err.at(-1)).toBe('Design/bare.r1 has no representations')
    expect(await run('get', 'Design', '--files', 'out/all')).toBe(1) // a Kind alone writes nothing: refused, not silent
    expect(err.at(-1)).toBe('--files takes <Kind>/<name> and no --behind')
    expect(await run('get', 'Design/ui.r1', '--behind', '--files', 'out/all')).toBe(1)
    expect(await run('get', 'Spec/cap-1', '--behind')).toBe(1)
    expect(err.at(-1)).toBe('--behind takes a Kind, not a name')
  })

  it('design-coverage runs the Gate alone over a stored model and the Designs its query finds, and the tree names what is unrealised', async () => {
    await run('init')
    const docs = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS()).filter(Boolean)
    const model = 'domainModel={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: DomainModel, id: expenses-model, revision: 1}}'
    expect(await run('create', file('DomainModel.yaml', [docs.find((d) => d.kind === 'DomainModel')]))).toBe(0)
    out = []
    expect(await run('run', 'design-coverage', '--input', model, '--follow')).toBe(0) // no Design yet: the query answers an empty list, everything unrealised
    expect(out).toContain('  passed  true')
    const empty = out.find((l) => l.startsWith('created WorkflowRun/'))!.slice('created '.length)
    out = []
    expect(await run('tree', empty)).toBe(0)
    expect(out.map((l) => l.trim()).filter((l) => l.startsWith('warning unrealised: ')).some((l) => l.includes('readModel My Claims View'))).toBe(true)
    expect(await run('create', file('Design.yaml', [docs.find((d) => d.kind === 'Design')]))).toBe(0)
    const other = structuredClone(docs.find((d) => d.kind === 'Design'))
    Object.assign(other.metadata, { name: 'other-api.r1' })
    Object.assign(other.spec.identity, { id: 'other-api' })
    other.spec.content.domainModel = 'another-model' // names another model: not queried, so its elements realise nothing here
    other.spec.content.elements = other.spec.content.elements.map((e: { realises: { kind: string } }) => ({ ...e, realises: { kind: 'command', name: 'Set Risk Flag' } }))
    expect(await run('create', file('Other.yaml', [other]))).toBe(0)
    out = []
    expect(await run('run', 'design-coverage', '--input', model, '--follow')).toBe(0)
    expect(out.some((l) => /^WorkflowRun\s+design-coverage-[0-9a-f]{6}\s+Succeeded/.test(l))).toBe(true)
    const ran = out
    out = []
    expect(await run('get', `GateRun/${ran.find((l) => l.startsWith('created WorkflowRun/'))!.slice('created WorkflowRun/'.length)}-coverage`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.designs.refs.map((r: { id: string }) => r.id)).toEqual(['claims-api']) // the query bound it, not other-api, which names another model
    out = ran
    expect(out).toContain('  passed  true') // a report: warnings on a pass
    const name = out.find((l) => l.startsWith('created WorkflowRun/'))!.slice('created '.length)
    out = []
    expect(await run('tree', name)).toBe(0)
    const warnings = out.map((l) => l.trim()).filter((l) => l.startsWith('warning unrealised: '))
    expect(warnings).toContain('warning unrealised: command Set Risk Flag: no Design of expenses-model realises it')
    expect(warnings.some((l) => l.includes('readModel My Claims View'))).toBe(false) // GET /claims/mine realises it
    // what the Export Policy invokes is noted as internal, an info the tree shows beside the warnings
    expect(out.map((l) => l.trim())).toContain('info unrealised-internal: command Export Claim: invoked by Export Policy; no Design of expenses-model realises it, a handler does')
    const step = parse(readFileSync('packs/sdlc/global/80-workflows.yaml', 'utf8').split('\n---\n').find((d) => d.includes('name: design-coverage}'))!)
    expect(step.spec.steps[0].inputs.designs.fromQuery.where).toBe('has(content.domainModel) && content.domainModel == inputs.domainModel.id')
    expect(await run('run', 'plan-all', '--input', 'designs=kind:Plan')).toBe(1)
    expect(err.at(-1)).toMatch(/--input designs: no Plan in Namespace default/) // kind:<Kind> at run still needs one in the store
  })

  it('design-check runs design-gate alone over a stored Design; an error finding gives passed false, a warning rides on a pass', async () => {
    await run('init')
    const docs = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS()).filter(Boolean)
    for (const kind of ['Architecture', 'BusinessRules', 'DomainModel', 'Glossary', 'Design']) expect(await run('create', file(`${kind}.yaml`, [docs.find((d) => d.kind === kind)]))).toBe(0)
    const ref = (kind: string, id: string) => `${kind[0]!.toLowerCase()}${kind.slice(1)}={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: ${kind}, id: ${id}, revision: 1}}`
    const refs = [ref('Design', 'claims-api'), ref('Architecture', 'expense-claims-architecture'), ref('DomainModel', 'expenses-model'), ref('Glossary', 'expenses-glossary'), 'rules={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: BusinessRules, id: expenses-rules, revision: 1}}']
    const auditor = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'auditor', namespace: 'default' }, spec: { type: 'human', adapter: 'cli-human/v1', configuration: {} } }
    expect(await run('apply', file('auditor.yaml', [auditor]), '-n', 'default')).toBe(0) // the auditor after the check (23-pack-sdlc.md), answered here
    out = []
    expect(await run('run', 'design-check', ...refs.flatMap((r) => ['--input', r]), '--follow')).toBe(0)
    const name = out.find((l) => l.startsWith('created WorkflowRun/'))!.slice('created '.length)
    const audit = readdirSync(join(dir, '.persimmon', 'inbox'))[0]!.replace(/\.yaml$/, '')
    expect(await run('complete', audit, '--file', file('audit.yaml', [{ outputs: { audit: { kind: 'value', value: { passed: true, findings: [], evidence: [] } } } }]))).toBe(0)
    out = []
    expect(await run('tree', name)).toBe(0)
    expect(out.some((l) => /^WorkflowRun\s+design-check-[0-9a-f]{6}\s+Succeeded/.test(l))).toBe(true)
    expect(out).toContain('  passed  true')
    expect(out.map((l) => l.replace(/^[\s│]+/, '')).filter((l) => l.startsWith('warning term-unknown: '))).toEqual(['warning term-unknown: rule: no term or fact type of the Glossary names it', 'warning term-unknown: route: no term or fact type of the Glossary names it', 'warning term-unknown: reason: no term or fact type of the Glossary names it']) // the Glossary bound: the field check runs
    // a Design whose block the Architecture lacks: the Gate rejects, the run Succeeds with passed false, the finding in the tree
    const bad = structuredClone(docs.find((d) => d.kind === 'Design'))
    bad.spec.content.block = 'BB-9'
    bad.metadata.name = 'claims-api.r2'
    bad.spec.identity.revision = 2
    expect(await run('create', file('Design2.yaml', [bad]))).toBe(0)
    out = []
    expect(await run('run', 'design-check', ...refs.slice(1).flatMap((r) => ['--input', r]), '--input', 'design={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Design, id: claims-api, revision: 2}}', '--follow')).toBe(0)
    expect(out.some((l) => /^WorkflowRun\s+design-check-[0-9a-f]{6}\s+Succeeded/.test(l))).toBe(true) // the Gate ran: a rejection is its answer, not a failure
    expect(out).toContain('  passed  false')
    expect(out.map((l) => l.trim())).toContain('unknown-block: block BB-9 is not a building block of the Architecture')
  })

  it('run --follow returns when the run is parked on a human Task', async () => {
    await run('init')
    const ask = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'ask' }, spec: { inputs: { q: { type: { kind: 'value', schema: { type: 'string' } } } }, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } } }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Answer' }, timeout: '1h', sideEffects: 'none' } }
    const wf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'ask-wf' }, spec: { inputs: { q: { type: { kind: 'value', schema: { type: 'string' } } } }, entry: ['ask'], steps: [{ id: 'ask', uses: { kind: 'Task', name: 'ask' }, inputs: { q: { fromInput: 'q' } }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'ask', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h' } }
    expect(await run('apply', file('ask.yaml', [ask, wf]))).toBe(0)
    out = []
    expect(await run('run', 'ask-wf', '--input', 'q=ok?', '--follow')).toBe(0)
    const name = out[0]!.split('/')[1]!
    expect(out.at(-1)).toBe(`parked on you: persimmon complete ${name}-ask`)
    expect(out).toContain('ask   TaskRun   cli-human/v1   Waiting human') // follow lines carry the tree's words
    expect(out.some((l) => /^└─ ask   TaskRun   cli-human\/v1\s+Waiting human/.test(l))).toBe(true) // the tree once it parks
    expect(out).toContain(`      persimmon complete ${name}-ask`)
    out = []
    expect(await run('get', `WorkflowRun/${name}`)).toBe(0)
    expect(parse(out.join('\n')).spec.timeout).toBeUndefined() // the Workflow's 3h applies in the Handler
    // a string port takes a file's text as is: prose with colons is not YAML
    writeFileSync(join(dir, 'q.txt'), 'Title: a brief\nwith: colons, and a list:\n- not yaml\n')
    out = []
    expect(await run('run', 'ask-wf', '--input', 'q=@q.txt')).toBe(0)
    const name2 = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name2}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.q).toEqual({ kind: 'value', value: 'Title: a brief\nwith: colons, and a list:\n- not yaml' }) // one final newline dropped
    writeFileSync(join(dir, 'rv.yaml'), 'kind: value\nvalue: typed\n')
    out = []
    expect(await run('run', 'ask-wf', '--input', 'q=@rv.yaml')).toBe(0) // a RuntimeValue file passes through on a string port too
    expect(await run('get', `WorkflowRun/${out[0]!.split('/')[1]!}`)).toBe(0)
    expect(parse(out.slice(1).join('\n')).spec.inputs.q).toEqual({ kind: 'value', value: 'typed' })
    const num = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'num-wf' }, spec: { ...wf.spec, inputs: { n: { type: { kind: 'value', schema: { type: 'integer' } } } }, steps: [{ ...wf.spec.steps[0], inputs: { q: { literal: 'ok?' } } }] } }
    expect(await run('apply', file('num.yaml', [num]))).toBe(0)
    err = []
    expect(await run('run', 'num-wf', '--input', 'n=@q.txt')).toBe(1) // not a string port: the YAML error, not a string
    expect(err.at(-1)).toMatch(/--input n: Nested mappings are not allowed/)
  })

  it('create --follow drives a run to its terminal value and logs show the RunLog', async () => {
    await initDemo()
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const wr = example('run-workflowrun')
    const repoRef = wr.spec.inputs.repository.ref
    const runDoc = { apiVersion: wr.apiVersion, kind: wr.kind, metadata: { name: 'demo-001' }, spec: { ...wr.spec, inputs: { ...wr.spec.inputs, repository: { kind: 'externalResource', ref: { ...repoRef, locator: { ...repoRef.locator, path: dir } } } }, timeout: '1h' } } // research works in the repository: its locator needs a path
    out = []
    const code = await runCli(['create', file('run.yaml', [runDoc]), '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(code).toBe(1) // the fake adapter's execute answer is not a TaskResult
    expect(out[0]).toBe('created WorkflowRun/demo-001')
    expect(out.some((l) => /^WorkflowRun   demo-001   Failed  schema_violation: step research: /.test(l))).toBe(true) // the step's failure, not no_progress
    expect(out.some((l) => /^research   TaskRun   claude-code\/v1   Failed  schema_violation/.test(l))).toBe(true) // owned runs report as they change
    expect(out.findIndex((l) => /^WorkflowRun   demo-001   Failed/.test(l))).toBeGreaterThan(out.findIndex((l) => /^research   TaskRun .* Failed/.test(l))) // commit order: the child's failure before the parent's
    expect(out.at(-1)).toMatch(/^      schema_violation: /) // then the tree
    out = []
    expect(await run('get', 'WorkflowRun/demo-001')).toBe(0)
    const shown = parse(out.join('\n'))
    expect(shown.status).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation' } })
    out = []
    expect(await run('logs', 'TaskRun/demo-001-research')).toBe(0)
    expect(out.join('\n')).toMatch(/type: Created/)
    expect(out.join('\n')).toMatch(/type: AdapterFinished/)
    out = []
    expect(await run('tree', 'WorkflowRun/demo-001')).toBe(0)
    expect(out[0]).toMatch(/^WorkflowRun   demo-001\s+Failed\s+\d+s$/)
    expect(out[1]).toMatch(/^   schema_violation: step research: /) // the error under the run
    expect(out[2]).toMatch(/^└─ research   TaskRun   claude-code\/v1\s+Failed\s+\d+s$/) // owned runs branch under their owner
    expect(out[3]).toMatch(/^      schema_violation: /)
    expect(out).toHaveLength(4)
    out = []
    expect(await run('resume')).toBe(0)
    expect(out).toEqual(['open events: 0'])
    expect(await run('signal', 'WorkflowRun/demo-001', '--event-id', 'e1')).toBe(0)
    expect(await run('nope')).toBe(2)
    expect(await run()).toBe(2)
  })

  it('run builds a manual WorkflowRun from --input values and follows it', async () => {
    await initDemo()
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const repo = example('resource-refs').externalResourceRef
    writeFileSync(join(dir, 'repo.yaml'), stringify({ kind: 'externalResource', ref: repo }))
    out = []
    const code = await runCli(['run', 'prd-create', '--input', `repository=@${join(dir, 'repo.yaml')}`, '--timeout', '2h', '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(code).toBe(1)
    expect(out[0]).toMatch(/^created WorkflowRun\/prd-create-[0-9a-f]{6}$/)
    const name = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name}`)).toBe(0)
    const shown = parse(out.join('\n'))
    expect(shown.spec).toMatchObject({ workflowRef: { kind: 'Workflow', name: 'prd-create' }, inputs: { repository: { kind: 'externalResource', ref: repo } }, timeout: '2h', origin: { kind: 'manual' } })
    expect(shown.metadata.namespace).toBe('default')

    // a Pipeline runs by name too; the run records the kind it named (21-composition.md)
    const prdCreate = parse(readFileSync('packs/demo/global/80-workflows.yaml', 'utf8').split('---').find((d) => d.includes('name: prd-create'))!).spec
    const pipeline = { apiVersion: 'persimmon.ai/v1', kind: 'Pipeline', metadata: { name: 'prd-pipe' }, spec: { inputs: prdCreate.inputs, outputs: prdCreate.outputs, outputBindings: prdCreate.outputBindings, phases: prdCreate.steps, timeout: '3h' } }
    expect(await run('apply', file('pipe.yaml', [pipeline]))).toBe(0)
    out = []
    expect(await run('run', 'prd-pipe', '--input', `repository=@${join(dir, 'repo.yaml')}`)).toBe(0)
    expect(out[0]).toMatch(/^created WorkflowRun\/prd-pipe-[0-9a-f]{6}$/)
    const pname = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${pname}`)).toBe(0)
    expect(parse(out.join('\n')).spec.workflowRef).toEqual({ kind: 'Pipeline', name: 'prd-pipe' })
    // a bare path on an externalResource port becomes a repository ref pinned to HEAD
    out = []
    expect(await run('run', 'prd-create', '--input', `repository=${process.cwd()}`)).toBe(0)
    const name2 = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name2}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.repository).toMatchObject({ kind: 'externalResource', ref: { provider: 'git', type: 'repository', id: 'persimmon', locator: { path: process.cwd() }, version: expect.stringMatching(/^[0-9a-f]{40}$/) } })
    expect(parse(out.join('\n')).spec.timeout).toBeUndefined() // no --timeout: the Handler uses the Workflow's (17-runs.md)
    // a revision document on an artifact port is stored and referenced
    const prdDoc = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', metadata: { name: 'spec-1.r1' }, spec: { identity: { id: 'spec-1', revision: 1 }, content: { title: 'Spec', problem: 'p', requirements: [{ id: 'R1', statement: 's' }] } } }
    out = []
    expect(await run('run', 'prd-approval', '--input', `prd=@${file('prd.yaml', [prdDoc])}`)).toBe(0)
    const name3 = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name3}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.prd).toEqual({ kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'default', id: 'spec-1', revision: 1 } })
    out = []
    expect(await run('get', 'ProductRequirement/spec-1.r1')).toBe(0)
    expect(parse(out.join('\n')).spec.content.title).toBe('Spec')
    expect(await run('run', 'prd-approval', '--input', `prd=@${file('prd.yaml', [prdDoc])}`)).toBe(0) // a second run reuses the stored revision
    // a hand-written revision is stamped like a published one and its event fires the pack's Trigger
    out = []
    expect(await run('get', 'ProductRequirement/spec-1.r1')).toBe(0)
    const rev = parse(out.join('\n'))
    expect(rev.spec.provenance).toEqual({ producerRef: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'default', name: 'spec-1.r1' }, inputs: [], actor: { kind: 'user', id: 'local' } })
    expect(rev.status.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    out = []
    expect(await run('get', 'WorkflowRun')).toBe(0)
    expect(out.some((l) => /^WorkflowRun\/on-prd-published-/.test(l))).toBe(true) // artifact.published reached on-prd-published
    // a ref on an artifact port must be in the store before the run exists
    expect(await run('run', 'prd-approval', '--input', 'prd={kind: artifact, ref: {apiVersion: engineering.persimmon.ai/v1, kind: ProductRequirement, namespace: default, id: spec-1, revision: 9}}')).toBe(1)
    expect(err.at(-1)).toMatch(/--input prd: ProductRequirement spec-1 revision 9 is not in the store/)
    expect(await run('run', 'prd-approval', '--input', 'prd={kind: artifact, ref: {apiVersion: engineering.persimmon.ai/v1, kind: ProductRequirement, namespace: other, id: spec-1, revision: 1}}')).toBe(1)
    expect(err.at(-1)).toMatch(/--input prd: ProductRequirement spec-1 is in Namespace other, not the run's/)
    out = []
    expect(await run('run', 'prd-approval', '--input', 'prd={kind: artifact, ref: {apiVersion: engineering.persimmon.ai/v1, kind: ProductRequirement, id: spec-1, revision: 1}}')).toBe(0) // a bare ref is in the run's Namespace
    const wrong = { ...prdDoc, metadata: { name: 'spec-1.r3' }, spec: { ...prdDoc.spec, identity: { id: 'spec-1', revision: 3 } } }
    expect(await run('create', file('prd3.yaml', [wrong]))).toBe(1)
    expect(err.at(-1)).toMatch(/revision 3 is not the next one \(2\)/)
    const bumped = { ...prdDoc, spec: { ...prdDoc.spec, identity: { id: 'spec-1', revision: 2 } } } // name still spec-1.r1: refused, not mistaken for the stored one
    expect(await run('create', file('prd-bumped.yaml', [bumped]))).toBe(1)
    expect(err.at(-1)).toMatch(/name must be spec-1\.r2/)
    const forged = { ...prdDoc, metadata: { name: 'spec-1.r2' }, spec: { ...prdDoc.spec, identity: { id: 'spec-1', revision: 2 }, content: { ...prdDoc.spec.content, title: 'Spec 2' }, provenance: { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', name: 'x' }, inputs: [], actor: { kind: 'handler', id: 'task' } } } }
    expect(await run('create', file('prd-forged.yaml', [forged]))).toBe(0)
    out = []
    expect(await run('get', 'ProductRequirement/spec-1.r2')).toBe(0)
    expect(parse(out.join('\n')).spec.provenance.actor).toEqual({ kind: 'user', id: 'local' }) // provenance is never caller-supplied
    out = []
    expect(await run('get', 'ProductRequirement/spec-1')).toBe(0) // a bare id: the latest revision
    expect(parse(out.join('\n')).metadata.name).toBe('spec-1.r2')
    expect(await run('get', 'ProductRequirement/spec-9')).toBe(1)
    expect(await run('delete', 'ProductRequirement/spec-1')).toBe(1) // delete never falls back to a revision
    expect(err.at(-1)).toMatch(/not found/)
    expect(await run('get', 'Task/write')).toBe(1) // a non-revisioned kind: no glob over write-prd
    // an artifacts port takes a list: a revision document is stored, a RevisionRef is taken as is
    const pk = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }
    const pair = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'pair' }, spec: { inputs: { prds: { type: { kind: 'artifacts', artifactKind: pk } } }, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } } }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Compare', context: [{ kind: 'artifact', input: 'prds' }] }, timeout: '1h', sideEffects: 'none' } }
    const pairWf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'pair-wf' }, spec: { inputs: { prds: { type: { kind: 'artifacts', artifactKind: pk } } }, entry: ['pair'], steps: [{ id: 'pair', uses: { kind: 'Task', name: 'pair' }, inputs: { prds: { fromInput: 'prds' } }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'pair', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h' } }
    expect(await run('apply', file('pair.yaml', [pair, pairWf]))).toBe(0)
    const r2 = { ...pk, namespace: 'default', id: 'spec-1', revision: 2 }
    expect(await run('run', 'pair-wf', '--input', `prds=@${file('bad.yaml', [[prdDoc, { id: 'x' }]])}`)).toBe(1)
    expect(err.at(-1)).toMatch(/--input prds\[1\]: neither a revision document nor a RevisionRef/)
    out = []
    expect(await run('run', 'pair-wf', '--input', `prds=@${file('prds.yaml', [[prdDoc, { ...r2, namespace: undefined }]])}`, '--follow')).toBe(0) // a ref without a Namespace is in the run's
    const pairRun = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${pairRun}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.prds).toEqual({ kind: 'artifacts', refs: [{ ...r2, revision: 1 }, r2] })
    // kind:<Kind> lists every artifact of the kind in the run's Namespace at its latest revision (33-multi-context-product.md)
    expect(await run('run', 'pair-wf', '--input', 'prds=kind:Glossary')).toBe(1)
    expect(err.at(-1)).toMatch(/--input prds: no Glossary in Namespace default/)
    expect(await run('run', 'ask-wf', '--input', 'q=kind:ProductRequirement')).toBe(1)
    expect(err.at(-1)).toMatch(/kind:<Kind> lists artifacts; q is not an artifacts port/)
    out = []
    expect(await run('run', 'pair-wf', '--input', 'prds=kind:ProductRequirement', '--follow')).toBe(0)
    const kindRun = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${kindRun}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.prds).toEqual({ kind: 'artifacts', refs: [r2] })
    out = []
    expect(await run('get', `TaskRun/${pairRun}-pair`)).toBe(0)
    expect(parse(out.join('\n')).status.context.map((c: { ref: { revision: number } }) => c.ref.revision)).toEqual([1, 2]) // one context entry per ref, in order
    // a revisioned kind's schema may change where every committed revision still validates (01-kind-definition.md)
    out = []
    expect(await run('get', 'KindDefinition/productrequirements.engineering.persimmon.ai')).toBe(0)
    const prdKind = parse(out.join('\n'))
    const widened = structuredClone(prdKind)
    widened.spec.versions[0].schema.properties.tagline = { type: 'string' }
    out = []
    expect(await run('apply', file('prd-kind-wide.yaml', [widened]))).toBe(0)
    expect(out).toEqual(['updated KindDefinition/productrequirements.engineering.persimmon.ai'])
    const narrowed = structuredClone(prdKind)
    narrowed.spec.versions[0].schema.required = [...narrowed.spec.versions[0].schema.required, 'tagline']
    out = []
    expect(await run('apply', file('prd-kind-narrow.yaml', [narrowed]))).toBe(1)
    expect(err.at(-1)).toMatch(/^error KindDefinition\/productrequirements.engineering.persimmon.ai: ProductRequirement\/default\/spec-1.r1 fails the new schema: .*tagline/)
    expect(await run('validate', file('prd-kind-narrow.yaml', [narrowed]))).toBe(1) // validate sees the project's revisions too
    expect(out.some((l) => l.includes('ProductRequirement/default/spec-1.r1 fails the new schema'))).toBe(true)
    const tagged = { ...prdDoc, metadata: { name: 'spec-1.r1', namespace: 'other' }, spec: { ...prdDoc.spec, content: { ...prdDoc.spec.content, tagline: 'x' } } }
    expect(await run('create', file('prd-other.yaml', [tagged]))).toBe(0) // a second Namespace; its revision alone fails the next change
    const typed = structuredClone(widened)
    typed.spec.versions[0].schema.properties.tagline = { type: 'integer' }
    expect(await run('apply', file('prd-kind-typed.yaml', [typed]))).toBe(1)
    expect(err.at(-1)).toMatch(/ProductRequirement\/other\/spec-1.r1 fails the new schema: .*tagline/)
    expect(parseInput('n=12')).toEqual(['n', { kind: 'value', value: 12 }])
    expect(parseInput('s=hello world')).toEqual(['s', { kind: 'value', value: 'hello world' }])
    expect(parseInput('a={kind: artifact, ref: {id: x}}')).toEqual(['a', { kind: 'artifact', ref: { id: 'x' } }])
    expect(() => parseInput('novalue')).toThrow(/<port>=<value>/)
  }, 30_000) // init applies the whole SDLC pack before the runs: near five seconds, the default limit

  it('an unknown flag is an error with usage, exit 2', async () => {
    expect(await run('run', 'wf', '--inputs', 'x=1')).toBe(2)
    expect(err.at(-1)).toMatch(/Unknown option '--inputs'/)
    expect(out.at(-1)).toMatch(/^usage: persimmon/)
  })

  it('complete refuses a TaskRun that is not waiting for a human, and stops at EOF keeping the form', async () => {
    await initDemo()
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const wr = example('run-workflowrun')
    await runCli(['create', file('run.yaml', [{ apiVersion: wr.apiVersion, kind: wr.kind, metadata: { name: 'demo-002' }, spec: { ...wr.spec, timeout: '1h' } }]), '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(await run('complete', 'demo-002-research', '--file', file('r.yaml', [{ protocol: 'persimmon.result/v1', outputs: {} }]))).toBe(1)
    expect(err.at(-1)).toMatch(/is Failed.*not waiting for a human/)
  })

  it('a form example is a value shaped like the schema, never the schema', () => {
    expect(template({ type: 'object', required: ['title', 'tags', 'level'], properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, level: { enum: ['low', 'high'] }, extra: { type: 'integer' } } })).toEqual({ title: '', tags: [''], level: 'low' })
    expect(template({ type: 'object', properties: { n: { type: 'number' }, ok: { type: 'boolean' }, items: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } })).toEqual({ n: 0, ok: false, items: [{ id: '' }] })
    expect(template({ type: 'object', required: ['a', 'b'], properties: { a: { $ref: '#/$defs/x' }, b: { oneOf: [{ type: 'integer' }, { type: 'string' }] } }, $defs: { x: { type: 'object', required: ['y'], properties: { y: { type: 'boolean' } } } } })).toEqual({ a: { y: false }, b: 0 })
    expect(template({ allOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, { required: ['b'], properties: { b: { type: 'integer' } } }] })).toEqual({ a: '', b: 0 })
    expect(template({ type: 'array', minItems: 2, items: { type: 'string' } })).toEqual(['', ''])
    expect(template({ type: 'array', items: [{ type: 'string' }] })).toEqual([])
  })

  it('the interactive form: reject with findings, an artifact answer through the example loop, a form without reading', async () => {
    const asks: { prompt: string; mode: string }[] = []
    const scripted = (answers: (string | null)[]) => async (prompt: string, mode: string) => (asks.push({ prompt, mode }), answers.shift() ?? null)
    const prd: Form['reading'] = [{ kind: 'ProductRequirement', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'default', id: 'p', revision: 1 }, content: { title: 'P' } }]
    const result = { type: { kind: 'value' as const, schema: { type: 'object', required: ['passed', 'findings', 'evidence'], properties: { passed: { type: 'boolean' }, findings: { type: 'array' }, evidence: { type: 'array' } } } } }
    // reject: n, two blocking findings; evidence is what was shown
    let c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['n', 'no acceptance criteria\nno owner']) }, { instructions: 'Approve?', reading: prd, outputs: { result } }, 'tr')
    expect(c).toEqual({ taskResult: { protocol: 'persimmon.result/v1', outputs: { result: { kind: 'value', value: { passed: false, findings: [{ severity: 'error', code: 'blocking_1', message: 'no acceptance criteria' }, { severity: 'error', code: 'blocking_2', message: 'no owner' }], evidence: [prd[0]!.ref] } } } }, publish: [] })
    expect(asks.map((a) => a.mode)).toEqual(['line', 'block'])
    expect(out.join('\n')).toContain('── ProductRequirement p r1 ──\ntitle: P')
    // artifact output: bad YAML, then a schema miss, then a good answer; published under a DNS-label id
    asks.length = 0
    out = []
    const report = { type: { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ReviewReport' } } }
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['verdict: [', 'verdict: 3', 'verdict: approve']) }, { instructions: 'Review', reading: [], inputs: { prd: { kind: 'artifact', ref: prd[0]!.ref } }, outputs: { Report: report }, outputSchemas: { Report: { type: 'object', required: ['verdict'], properties: { verdict: { enum: ['approve', 'revise'] } } } }, outputIds: {} }, 'my-Run')
    expect(c).toEqual({ taskResult: { protocol: 'persimmon.result/v1', outputs: {} }, publish: [{ port: 'Report', request: { kind: report.type.artifactKind, id: 'my-run-report', content: { verdict: 'approve' }, representations: [] } }] })
    // the Task chose the id: the form carries it and the publish uses it; a form from before chosen ids is refused before anything is signalled
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['verdict: approve']) }, { instructions: 'Review', reading: [], outputs: { Report: report }, outputSchemas: {}, outputIds: { Report: 'checkout-review' } }, 'my-Run')
    expect(c.publish[0]!.request.id).toBe('checkout-review')
    await expect(askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted([]) }, { instructions: 'Review', reading: [], outputs: { Report: report } }, 'my-Run')).rejects.toThrow(/predates chosen artifact ids/)
    expect(asks).toHaveLength(4)
    expect(asks[0]!.prompt).toContain('for example:\nverdict: approve') // the example, not the schema
    expect(err.filter((l) => l.startsWith('not YAML') || l.startsWith('Report:'))).toHaveLength(2)
    expect(out.join('\n')).toContain('inputs:') // no reading: the references are shown instead
    // an artifact the adapter could not fetch is shown as unavailable and is not evidence
    asks.length = 0
    out = []
    const gone = { kind: 'ReviewReport', ref: { ...prd[0]!.ref, kind: 'ReviewReport', id: 'r' }, error: 'not_found' }
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['y', '']) }, { instructions: 'Approve?', reading: [...prd, gone], outputs: { result } }, 'tr')
    expect(out.join('\n')).toContain('── ReviewReport r r1 ──\n(unavailable: not_found)')
    expect((c.taskResult as { outputs: { result: { value: { evidence: unknown[] } } } }).outputs.result.value.evidence).toEqual([prd[0]!.ref])
    // an older form (references only) still records the reviewed artifact as evidence
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['y', '']) }, { instructions: 'Approve?', inputs: { prd: { kind: 'artifact', ref: prd[0]!.ref } }, outputs: { result } }, 'tr')
    expect((c.taskResult as { outputs: { result: { value: { evidence: unknown[] } } } }).outputs.result.value.evidence).toEqual([prd[0]!.ref])
  })

  it('complete --file: an artifact port\'s value is its content, published under the chosen id; a value port passes through (35-build-process.md)', () => {
    const record = { type: { kind: 'artifact' as const, artifactKind: { apiVersion: 'sdd.persimmon.ai/v1', kind: 'AcceptanceRecord' } } }
    const note = { type: { kind: 'value' as const, schema: { type: 'string' } } }
    const form: Form = { instructions: 'Build T-1', outputs: { record, note }, outputIds: { record: 'p-t-1' } }
    const content = { plan: 'p', task: 'T-1' }
    expect(fromFile({ outputs: { record: content, note: { kind: 'value', value: 'ok' } } }, form, 'tr')).toEqual({
      taskResult: { protocol: 'persimmon.result/v1', outputs: { note: { kind: 'value', value: 'ok' } } },
      publish: [{ port: 'record', request: { kind: record.type.artifactKind, id: 'p-t-1', content, representations: [] } }],
    })
    expect(fromFile({ outputs: { record: content } }, { ...form, outputIds: {} }, 'my-Run').publish[0]!.request.id).toBe('my-run-record') // no chosen id: <taskRun>-<port>
    expect(fromFile({ protocol: 'persimmon.result/v1', outputs: { note: { kind: 'value', value: 'ok' } } }, undefined, 'tr').publish).toEqual([]) // no form: RuntimeValues as written
    expect(() => fromFile({ outputs: { record: content } }, undefined, 'tr', '.persimmon/inbox/tr.yaml')).toThrow('no inbox form at .persimmon/inbox/tr.yaml')
    expect(() => fromFile({ outputs: { record: content } }, { instructions: '', outputs: { record } }, 'tr')).toThrow(/predates chosen artifact ids/)
    expect(() => fromFile({ outputs: { record: { kind: 'artifact', ref: { id: 'x' } } } }, form, 'tr')).toThrow(/write the content of the artifact, not a ref/)
    expect(() => fromFile({ outputs: { note: 'ok' } }, form, 'tr')).toThrow(/note is a value port: write \{kind: value/)
    expect(() => fromFile({ outputs: { note: { kind: 'value', value: 3 } } }, form, 'tr')).toThrow(/complete: note: /) // the value's schema
    expect(() => fromFile({ outputs: { record: { plan: 7 } } }, { ...form, outputSchemas: { record: { type: 'object', properties: { plan: { type: 'string' } } } } }, 'tr')).toThrow(/complete: record: /) // the kind's schema
    expect(() => fromFile({ outputs: { other: content } }, form, 'tr')).toThrow(/other is no output of this Task/)
  })

  it('complete --file publishes a human Task\'s artifact under the chosen id; bad content is refused before the Signal and the form kept', async () => {
    await run('init')
    const kind = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'AcceptanceRecord' }
    const task = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'hand-record' }, spec: { outputs: { record: { type: { kind: 'artifact', artifactKind: kind }, id: { literal: 'p-t-1' } } }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Build T-1' }, timeout: '1h', sideEffects: 'none' } }
    const wf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'hand' }, spec: { outputs: {}, outputBindings: {}, entry: ['build'], steps: [{ id: 'build', uses: { kind: 'Task', name: 'hand-record' }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'build', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '2h' } }
    expect([await run('apply', file('hand.yaml', [task, wf])), err]).toEqual([0, []])
    expect(await run('run', 'hand', '--follow')).toBe(0)
    out = []
    await run('get', 'TaskRun')
    const taskRun = out[0]!.split(/\s/)[0]!.replace('TaskRun/', '')
    const form = join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`)
    expect(existsSync(form)).toBe(true)
    const content = { plan: 'p', spec: 's', task: 'T-1', verifies: [{ scenario: 'AC-1', tests: ['claim > ac 1'] }], summary: 'built', openQuestions: [] }
    err = []
    expect(await run('complete', taskRun, '--file', file('bad.yaml', [{ outputs: { record: { ...content, task: 'one' } } }]))).toBe(1)
    expect(err.at(-1)).toMatch(/complete: record: .*task/)
    expect(existsSync(form)).toBe(true) // nothing signalled: answer again
    out = []
    expect(await run('complete', taskRun, '--file', file('record.yaml', [{ outputs: { record: content } }]))).toBe(0)
    expect(out.some((l) => /TaskRun\s+cli-human\/v1\s+Succeeded/.test(l))).toBe(true)
    out = []
    expect(await run('get', 'AcceptanceRecord/p-t-1')).toBe(0)
    expect(out.join('\n')).toContain('summary: built')
  }, 30_000)

  it('adapter test runs the conformance suite over an installed Adapter', async () => {
    await run('init')
    out = []
    expect(await run('adapter', 'test', 'subprocess/v1')).toBe(0)
    expect(out[0]).toMatch(/^E1  pass  describe/)
    expect(out.filter((l) => / FAIL /.test(l))).toEqual([])
    expect(out.some((l) => l.startsWith('E11 skip  the prompt'))).toBe(true) // script and tool types have no prompt
    out = []
    expect(await run('adapter', 'test', 'nope/v1')).toBe(1)
    expect(err.at(-1)).toBe('adapter nope/v1 not installed')
    expect(await run('adapter', 'test', 'subprocess/v1', '--config', file('c.yaml', [{ program: 7 }]))).toBe(1)
    expect(err.at(-1)).toMatch(/c\.yaml: .*\/program must be array/)
  }, 60_000)

  it('complete on an unknown TaskRun is not found', async () => {
    await run('init')
    expect(await run('complete', 'nope')).toBe(1)
    expect(err.at(-1)).toMatch(/not found/)
  })
})

