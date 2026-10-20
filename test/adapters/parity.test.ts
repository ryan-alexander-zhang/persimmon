// The Rewrite pack's source index and checks (40-pack-rewrite.md): a real checkout read into the index, and one mutation
// of the JPetStore example per finding code.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { checkInventory, checkSurvey, parseWhere } from '../../adapters/parity/check.mjs'
import { branchLines, indexSource } from '../../adapters/parity/source.mjs'

const root = join(import.meta.dirname, '..', '..')
const docs = parseAllDocuments(readFileSync(join(root, 'docs/design/examples/rewrite-jpetstore.yaml'), 'utf8')).map((d) => d.toJS())
const named = (name: string) => structuredClone(docs.find((d) => d.metadata.name === name).spec.content)
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

describe('branchLines', () => {
  it('a C-family file branches on if, case, catch and the ternary, never in a comment or a string', () => {
    const java = ['class A {', '  // if (x) in a comment', '  int f(int x) {', '    if (x > 0) return 1;', '    String s = "if (y)";', '    switch (x) { case 1: return 2; }', '    try { g(); } catch (Exception e) {}', '    return x > 9 ? 3 : 4;', '    for (int i = 0; i < x; i++) {}', '  }', '}'].join('\n')
    expect(branchLines('A.java', java)).toEqual([4, 6, 7, 8])
  })

  it('COBOL branches on IF, WHEN, file status clauses and UNTIL, never on END-IF, ELSE or a comment line', () => {
    const cbl = [
      '       PROCEDURE DIVISION.',
      '      * IF THIS IS A COMMENT',
      '           IF WS-AMT > 0',
      '              ADD 1 TO WS-N',
      '           ELSE',
      '              CONTINUE',
      '           END-IF',
      '           READ ACCT-FILE INVALID KEY MOVE 100 TO WS-REASON',
      '           EVALUATE TRUE',
      '              WHEN WS-A = 1 CONTINUE',
      '           END-EVALUATE',
      '           PERFORM UNTIL END-OF-FILE = "Y" END-PERFORM',
    ].join('\n')
    expect(branchLines('CBTRN02C.cbl', cbl)).toEqual([3, 8, 10, 12])
  })

  it('Python branches on if, elif, except and the conditional expression; a language not in the table has none', () => {
    expect(branchLines('a.py', ['if a:', '    pass', 'elif b:', '    pass', '# if c', 'x = 1 if d else 2', 'try:', '    f()', 'except E:', '    pass'].join('\n'))).toEqual([1, 3, 6, 9])
    expect(branchLines('notes.txt', 'if this were code')).toBeNull() // unread, not branchless: branch-unread says so
  })

  it('an if without parentheses branches (Go, Rust, Swift); every case arm does, a Scala case class does not', () => {
    expect(branchLines('a.go', 'func f() {\n  if err != nil {\n    return\n  }\n}')).toEqual([2])
    expect(branchLines('a.rs', "fn f<'a>(x: &'a str) {\n  if x.is_empty() { return; }\n}")).toEqual([2])
    expect(branchLines('A.java', 'switch (k) {\n  case A -> 1;\n  default -> 2;\n}')).toEqual([2])
    expect(branchLines('a.scala', 'case class C(a: Int)\nx match {\n  case 1 => "one"\n}')).toEqual([3])
  })

  it('nullable types, optional chaining, wildcards and a mock\'s when(...) are no branches; a Kotlin when block is', () => {
    expect(branchLines('A.kt', 'fun get(id: Long?): Customer? = repo.find(id)?.copy()\nwhen (x) {\n  1 -> a()\n}\nwhen(mock.call()).thenReturn(1)')).toEqual([2])
    expect(branchLines('A.java', 'for (List<? extends X> xs : all) {}\nint y = a > b ? a : b;')).toEqual([2])
  })

  it('a string or comment spanning lines hides its keywords: a template literal, a block comment, a docstring', () => {
    expect(branchLines('a.ts', 'const s = `\n  if (x) {\n`\n/* if (y)\n   if (z) */\nif (w) {}')).toEqual([6])
    expect(branchLines('a.py', 'def f():\n    """\n    if this were code\n    except that\n    """\n    if a:\n        pass')).toEqual([6])
  })

  it('COBOL data names holding a keyword are no branches; free format keeps its first columns', () => {
    expect(branchLines('A.cbl', '           MOVE "Y" TO WS-IF-FLAG\n           ADD 1 TO WS-WHEN-CNT\n           IF WS-IF-FLAG = "Y" CONTINUE END-IF')).toEqual([3])
    expect(branchLines('B.cbl', '>>SOURCE FORMAT FREE\nIF X > 0\n   DISPLAY "A"\nEND-IF\n*> IF in a comment')).toEqual([2])
  })
})

describe('indexSource', () => {
  const checkout = () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'parity-source-')))
    git(dir, 'init', '-q')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'A.java'), 'class A {\n  int f(int x) {\n    if (x > 0) return 1;\n    return 0;\n  }\n}\n')
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 0, 2]))
    writeFileSync(join(dir, 'untracked.java'), 'if (x) {}\n')
    git(dir, 'add', 'src', 'blob.bin')
    git(dir, 'commit', '-qm', 'source')
    return dir
  }

  it('reads every tracked text file with its line count and branch lines, the commit, and where the project is', () => {
    const source = checkout()
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'parity-project-')))
    const index = indexSource(source, project)
    expect(index.commit).toBe(git(source, 'rev-parse', 'HEAD'))
    expect(index.root).toBe(source)
    expect(index.files).toEqual({ 'src/A.java': { lines: 6, branchLines: [3] } }) // the binary and the untracked file are not the source's
    expect(index.project).toEqual({ root: project, gitCommonDir: undefined })
    expect(index.dirty).toEqual([])
  })

  it('names a tracked file changed in the working tree, follows no symlink, and refuses a directory that is no checkout', () => {
    const source = checkout()
    symlinkSync('/etc/hosts', join(source, 'hosts'))
    git(source, 'add', 'hosts')
    git(source, 'commit', '-qm', 'link')
    writeFileSync(join(source, 'src', 'A.java'), 'class A {}\n')
    const index = indexSource(source, tmpdir())
    expect(index.dirty).toEqual(['src/A.java'])
    expect(Object.keys(index.files)).toEqual(['src/A.java'])
    expect(() => indexSource(realpathSync(mkdtempSync(join(tmpdir(), 'parity-none-'))), tmpdir())).toThrow(/is not a git checkout with a commit/)
  })

  it('a worktree of the source shares its git directory, which is how source-inside-project tells it from a clone', () => {
    const source = checkout()
    const worktree = join(realpathSync(mkdtempSync(join(tmpdir(), 'parity-wt-'))), 'wt')
    git(source, 'worktree', 'add', '-q', worktree)
    const index = indexSource(source, worktree)
    expect(index.project.gitCommonDir).toBe(index.gitCommonDir)
    expect(checkInventory({ inventory: { source: { commit: index.commit } }, index, slices: [] }).map((f: { code: string }) => f.code)).toEqual(['source-inside-project'])
  })
})

describe('parseWhere', () => {
  it('reads a file, a line, a range, and leaves a locator alone', () => {
    expect(parseWhere('src/a.java')).toEqual({ path: 'src/a.java', from: undefined, to: undefined })
    expect(parseWhere('src/a.java:12')).toEqual({ path: 'src/a.java', from: 12, to: 12 })
    expect(parseWhere('src/a.java:12-30')).toEqual({ path: 'src/a.java', from: 12, to: 30 })
    expect(parseWhere({ in: 'db', locator: 'trigger T' })).toBeUndefined()
  })
})

// an index that holds every file the example's r2 inventory names, long enough for its lines, with the branch lines given
const files = (inventory: any, branches: Record<string, number[]> = {}) => {
  const paths = new Set<string>()
  const add = (w: unknown) => {
    const p = parseWhere(w)
    if (p) paths.add(p.path)
  }
  for (const list of ['entryPoints', 'stateChanges', 'guards', 'declarations', 'absences', 'plumbingPatterns', 'entities', 'externalSystems']) for (const x of inventory[list]) for (const w of x.where) add(w)
  for (const t of inventory.tests) add(t.where)
  for (const e of inventory.entryPoints) for (const f of e.reaches.files) paths.add(f)
  return Object.fromEntries([...paths].map((p) => [p, { lines: 800, branchLines: branches[p] ?? [] }]))
}
const index = (inventory: any, branches?: Record<string, number[]>) => ({
  commit: inventory.source.commit,
  root: '/work/jpetstore-6',
  gitCommonDir: '/work/jpetstore-6/.git',
  project: { root: '/work/petstore-rewrite', gitCommonDir: '/work/petstore-rewrite/.git' },
  files: files(inventory, branches),
})
const slices = () => named('jpetstore-parity.r1').slices
const codes = (found: { code: string }[]) => found.map((f) => f.code)

describe('checkInventory', () => {
  it('the example Slice is consistent', () => {
    const inventory = named('jpetstore-inventory.r2')
    expect(checkInventory({ inventory, index: index(inventory), slices: slices(), slice: 'SL-1' })).toEqual([])
  })

  it('source-inside-project: the checkout inside the project, the project inside it, or one git directory', () => {
    const inventory = named('jpetstore-inventory.r2')
    const at = (project: { root: string; gitCommonDir?: string }) => codes(checkInventory({ inventory, index: { ...index(inventory), project }, slices: slices(), slice: 'SL-1' }))
    expect(at({ root: '/work', gitCommonDir: undefined })).toEqual(['source-inside-project'])
    expect(at({ root: '/work/jpetstore-6/rewrite', gitCommonDir: undefined })).toEqual(['source-inside-project'])
    expect(at({ root: '/elsewhere', gitCommonDir: '/work/jpetstore-6/.git' })).toEqual(['source-inside-project'])
    expect(at({ root: '/work/jpetstore-6-rewrite', gitCommonDir: undefined })).toEqual([]) // a sibling whose name starts the same is outside
    expect(at({ root: '/work/jpetstore-6/..rewrite', gitCommonDir: undefined })).toEqual(['source-inside-project']) // a directory named ..x is inside
  })

  it('source-moved: the checkout at another commit than the inventory read, or changed in its working tree', () => {
    const inventory = named('jpetstore-inventory.r2')
    expect(codes(checkInventory({ inventory, index: { ...index(inventory), commit: 'deadbeef00' }, slices: slices(), slice: 'SL-1' }))).toEqual(['source-moved'])
    expect(codes(checkInventory({ inventory, index: { ...index(inventory), dirty: ['src/a.java'] }, slices: slices(), slice: 'SL-1' }))).toEqual(['source-moved'])
  })

  it('inventory-location: a reached file the checkout lacks, a path that is a property of every object, a Slice the cut lacks', () => {
    const inventory = named('jpetstore-inventory.r2')
    const idx = index(inventory)
    inventory.entryPoints[0].reaches.files.push('src/main/java/Gone.java')
    inventory.guards[1].where = ['constructor:1']
    expect(checkInventory({ inventory, index: idx, slices: slices(), slice: 'SL-1' }).map((f: { message: string }) => f.message)).toEqual([
      `GD-2 is at constructor:1, a file the checkout at ${idx.commit} lacks`,
      `EP-1 reaches is at src/main/java/Gone.java, a file the checkout at ${idx.commit} lacks`,
    ])
    expect(codes(checkInventory({ inventory: named('jpetstore-inventory.r2'), index: idx, slices: slices(), slice: 'SL-9' }))).toEqual(['inventory-location'])
  })

  it('branch-unread: a reached file whose branch lines the index could not read is a warning, never silence', () => {
    const inventory = named('jpetstore-inventory.r2')
    const idx = index(inventory)
    idx.files['src/main/java/org/mybatis/jpetstore/domain/Cart.java'].branchLines = null as unknown as number[]
    expect(checkInventory({ inventory, index: idx, slices: slices(), slice: 'SL-1' }).map((f: { severity: string; code: string }) => `${f.severity}:${f.code}`)).toEqual(['warning:branch-unread'])
  })

  it('inventory-location: a file the checkout lacks, a line past its end, a range that runs backwards; a locator is not checked', () => {
    const inventory = named('jpetstore-inventory.r2')
    const idx = index(inventory)
    inventory.guards[1].where = ['src/main/java/Gone.java:3']
    inventory.stateChanges[0].where = ['src/main/java/org/mybatis/jpetstore/service/OrderService.java:900']
    inventory.declarations[0].where = ['src/main/java/org/mybatis/jpetstore/service/OrderService.java:20-10', { in: 'db', locator: 'sequence ordernum' }]
    expect(codes(checkInventory({ inventory, index: idx, slices: slices(), slice: 'SL-1' }))).toEqual(['inventory-location', 'inventory-location', 'inventory-location'])
  })

  it('inventory-reference and id-sequence: a cited id the inventory lacks; an id repeated or out of order', () => {
    const inventory = named('jpetstore-inventory.r2')
    inventory.guards[1].in = ['EP-9']
    inventory.stateChanges[0].entity = 'EN-7'
    inventory.entities.reverse()
    const found = checkInventory({ inventory, index: index(inventory), slices: slices(), slice: 'SL-1' })
    expect(found.map((f: { message: string }) => f.message)).toEqual(['EN-1 follows EN-2 in entities: ids increase in document order', 'ST-1 cites EN-7, which the inventory lacks', 'GD-2 cites EP-9, which the inventory lacks'])
    const kind = named('jpetstore-inventory.r2')
    kind.stateChanges[0].entity = 'EP-1' // an id the inventory has, of the wrong kind
    expect(checkInventory({ inventory: kind, index: index(kind), slices: slices(), slice: 'SL-1' }).map((f: { message: string }) => f.message)).toEqual(['ST-1 cites EP-1 where EN-n belongs'])
  })

  it('branch-uncovered: a branch line of a file the Slice reaches, inside no guard nor plumbing pattern; a whole-file where covers none', () => {
    const inventory = named('jpetstore-inventory.r2')
    const cart = 'src/main/java/org/mybatis/jpetstore/web/controllers/CartController.java'
    const catalog = 'src/main/java/org/mybatis/jpetstore/web/controllers/CatalogController.java'
    const branches = { [cart]: [59, 101], 'src/main/java/org/mybatis/jpetstore/service/CatalogService.java': [152], [catalog]: [66] }
    const found = checkInventory({ inventory, index: index(inventory, branches), slices: slices(), slice: 'SL-1' })
    expect(found.map((f: { message: string }) => f.message)).toEqual([`${cart} branches at line 101, inside no guard and no plumbing pattern`]) // 59 is PP-1's, 152 GD-2's; CatalogController is SL-2's
    inventory.guards.push({ id: 'GD-3', condition: 'c', outcome: 'o', role: 'rule', where: [cart], in: ['EP-2'] })
    expect(codes(checkInventory({ inventory, index: index(inventory, branches), slices: slices(), slice: 'SL-1' }))).toEqual(['branch-uncovered'])
    inventory.guards[2].where = [`${cart}:100-102`]
    expect(checkInventory({ inventory, index: index(inventory, branches), slices: slices(), slice: 'SL-1' })).toEqual([])
  })

  it('reader-disagreement: a guard of either reader whose lines overlap none of the other\'s; a warning', () => {
    const inventory = named('jpetstore-inventory.r2')
    const second = named('jpetstore-inventory.r2')
    second.guards[1].where = ['src/main/java/org/mybatis/jpetstore/service/CatalogService.java:150-153'] // overlaps: the same guard, cut wider
    expect(checkInventory({ inventory, index: index(inventory), slices: slices(), slice: 'SL-1', second })).toEqual([])
    second.guards.splice(1, 1)
    const found = checkInventory({ inventory, index: index(inventory), slices: slices(), slice: 'SL-1', second })
    expect(found.map((f: { severity: string; code: string; message: string }) => [f.severity, f.code, f.message])).toEqual([['warning', 'reader-disagreement', "the first reader's GD-2 at src/main/java/org/mybatis/jpetstore/service/CatalogService.java:152-152 overlaps no guard of the other reader"]])
  })
})

describe('checkSurvey', () => {
  it('the example Survey and its cut are consistent', () => {
    const inventory = named('jpetstore-inventory.r1')
    expect(checkSurvey({ inventory, index: index(inventory), decisions: { approved: true, findings: [], slices: slices() } })).toEqual([])
  })

  it('slice-cut: every entry point in exactly one Slice, every Slice naming entry points the inventory has', () => {
    const inventory = named('jpetstore-inventory.r1')
    const cut = slices()
    cut[0].entryPoints.push('EP-4', 'EP-8')
    cut[1].entryPoints = ['EP-4']
    const found = checkSurvey({ inventory, index: index(inventory), decisions: { approved: true, findings: [], slices: cut } })
    expect(found.map((f: { message: string }) => f.message)).toEqual(['SL-1 names EP-8, which the inventory lacks', 'EP-4 is in SL-1 and SL-2: an entry point is in one Slice', 'EP-5 is in no Slice'])
  })
})

// one request to an Adapter over stdio, from a working directory: the engine runs an Adapter in the project directory
function stdio(adapter: string, request: unknown, cwd = root) {
  return new Promise<any>((resolve) => {
    const child = spawn(process.execPath, [join(root, 'adapters', adapter, 'index.mjs')], { cwd, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.on('close', () => resolve(out.trim().split('\n').map((l) => JSON.parse(l)).at(-1)))
    child.stdin.end(JSON.stringify(request) + '\n')
  })
}
const evaluate = (mode: string | undefined, artifacts: Record<string, unknown>, inputs: Record<string, unknown>) => ({
  id: 1,
  op: 'evaluate',
  payload: { artifacts: Object.fromEntries(Object.entries(artifacts).map(([k, c]) => [k, { content: c, provenance: {} }])), inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { kind: 'value', value: v }])), validator: { configuration: mode ? { mode } : {} } },
})

describe('parity/v1 over stdio', () => {
  it('checks a Survey or a Slice as its configuration says, and calls content that is no inventory a finding', async () => {
    const survey = named('jpetstore-inventory.r1')
    const ok = await stdio('parity', evaluate('survey', { inventory: survey }, { sourceIndex: index(survey), decisions: { approved: true, findings: [], slices: slices() } }))
    expect(ok.result).toEqual({ passed: true, findings: [], evidence: [] })
    const slice = named('jpetstore-inventory.r2')
    slice.guards[1].in = ['EP-9']
    const bad = await stdio('parity', evaluate('inventory', { inventory: slice, ledger: named('jpetstore-parity.r1') }, { sourceIndex: index(slice), slice: 'SL-1' }))
    expect([bad.result.passed, codes(bad.result.findings)]).toEqual([false, ['inventory-reference']])
    const none = await stdio('parity', evaluate(undefined, { inventory: { title: 'x' } }, {}))
    expect(codes(none.result.findings)).toEqual(['not-an-inventory'])
  })

  it('runs closure, recovery and parity on a ledger, each refusing to guess without the inputs it checks', async () => {
    const ledger = named('jpetstore-parity.r3')
    const inventory = named('jpetstore-inventory.r2')
    const compared = { ...ledger, rewrite: { tests: 6 } }
    const parity = await stdio('parity', evaluate('parity', { ledger: compared }, { slice: 'SL-1' }))
    expect(parity.result).toEqual({ passed: true, findings: [], evidence: [] }) // no inventory needed at the parity gate
    const unrun = await stdio('parity', evaluate('parity', { ledger }, { slice: 'SL-1' }))
    expect(unrun.result.findings.map((f: { message: string }) => f.message)).toEqual(['no rewrite run was compared in this ledger revision: compute-ledger runs after run-rewrite'])
    const failing = await stdio('parity', evaluate('parity', { ledger: { ...compared, verdict: { result: 'fail', rule: 'x' } } }, { slice: 'SL-1' }))
    expect([failing.result.passed, codes(failing.result.findings)]).toEqual([false, ['parity-verdict']])
    expect((await stdio('parity', evaluate('parity', { ledger: compared }, { slice: 'SL-2' }))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('a ledger revision of SL-2, not of SL-1') })
    const closure = await stdio('parity', evaluate('closure', { ledger, inventory }, { slice: 'SL-1', sourceIndex: index(inventory), coverage: { files: {}, unmapped: [] }, runs: [] }))
    expect(closure.result.passed).toBe(true)
    expect((await stdio('parity', evaluate('closure', { ledger, inventory }, { slice: 'SL-1', sourceIndex: index(inventory) }))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inputs.coverage and inputs.runs') })
    expect((await stdio('parity', evaluate('closure', { ledger, inventory }, { slice: 'SL-1' }))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inputs.sourceIndex') })
    expect((await stdio('parity', evaluate('recovery', { ledger, inventory }, { slice: 'SL-1' }))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('artifacts.prd') })
    expect((await stdio('parity', evaluate('parity', { ledger }, {}))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inputs.slice') })
  })

  it('refuses a missing or unknown mode, and a mode without the inputs it checks, rather than guess', async () => {
    const survey = named('jpetstore-inventory.r1')
    const inputs = { sourceIndex: index(survey), decisions: { approved: true, findings: [], slices: slices() }, slice: 'SL-1' }
    expect((await stdio('parity', evaluate(undefined, { inventory: survey }, inputs))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('configuration.mode') })
    expect((await stdio('parity', evaluate('closure', { inventory: survey }, inputs))).error).toMatchObject({ code: 'invalid_input' })
    expect((await stdio('parity', evaluate('survey', { inventory: survey }, { decisions: { approved: true } }))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inputs.sourceIndex') })
    expect((await stdio('parity', evaluate('inventory', { inventory: survey }, { sourceIndex: index(survey) }))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inputs.slice') })
  })
})

describe('parity-run/v1 over stdio', () => {
  const execute = (workspace: string | undefined, outputs: Record<string, unknown>) => ({
    id: 2,
    op: 'execute',
    payload: {
      taskRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'demo', name: 'r-index', uid: 'u1' }, logicalExecutionId: 'r//index', idempotencyKey: 'r//index/1', attempt: 1 },
      task: { instructions: '', outputs },
      executor: { type: 'script', configuration: {} },
      inputs: {},
      context: [],
      deadline: new Date(Date.now() + 60_000).toISOString(),
      credentials: {},
      engine: { endpoint: 'unix:///nowhere.sock', token: 'ct-1' },
      ...(workspace ? { workspace } : {}),
    },
  })
  const asks = { sourceIndex: { type: { kind: 'value', schema: { type: 'object' } } } }

  it('answers a sourceIndex output with the workspace read as the source, the project being where it runs', async () => {
    const source = realpathSync(mkdtempSync(join(tmpdir(), 'parity-run-source-')))
    git(source, 'init', '-q')
    writeFileSync(join(source, 'A.java'), 'class A { void f(int x) { if (x > 0) {} } }\n')
    git(source, 'add', 'A.java')
    git(source, 'commit', '-qm', 'a')
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'parity-run-project-')))
    const r = await stdio('parity-run', execute(source, asks), project)
    expect(r.result.outputs.sourceIndex).toMatchObject({ kind: 'value' })
    expect(r.result.outputs.sourceIndex.value).toMatchObject({ commit: git(source, 'rev-parse', 'HEAD'), root: source, dirty: [], project: { root: project }, files: { 'A.java': { lines: 1, branchLines: [1] } } })
  })

  it('run-source: resets, runs each level on the source with its path, and answers tests, observations and mapped coverage', async () => {
    const source = realpathSync(mkdtempSync(join(tmpdir(), 'parity-run-src-')))
    git(source, 'init', '-q')
    writeFileSync(join(source, 'A.java'), 'class A {\n  int f(int x) { if (x > 0) return 1; return 0; }\n}\n')
    git(source, 'add', 'A.java')
    git(source, 'commit', '-qm', 'a')
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'parity-run-prj-')))
    // the suite: two tests, one red, what each observed, and lcov naming the source file by its absolute path
    writeFileSync(join(project, 'suite.mjs'), [
      "import { mkdirSync, writeFileSync, existsSync } from 'node:fs'",
      "mkdirSync('build', { recursive: true })",
      "writeFileSync('build/app.xml', '<testsuite><testcase name=\"test_EP1_GD1_a\"/><testcase name=\"test_EP1_b\"><failure message=\"no\"/></testcase></testsuite>')",
      "writeFileSync('build/app.json', JSON.stringify({ test_EP1_GD1_a: { total: '1.00' }, reset: existsSync('reset.flag') }))",
      "writeFileSync('build/app.lcov', `SF:${process.env.PERSIMMON_SOURCE}/A.java\\nDA:2,3\\nDA:3,0\\nend_of_record\\n`)",
      'process.exit(1)', // a red suite is an answer
    ].join('\n'))
    const index = indexSource(source, project)
    const level = { tool: 'node', run: 'node suite.mjs', one: 'node suite.mjs {test}', reset: "node -e \"require('fs').writeFileSync('reset.flag','1')\"", junit: 'build/app.xml', observations: 'build/app.json', testDir: '.', coverage: 'build/app.lcov' }
    const withInputs = (levels: Record<string, unknown>) => {
      const r: any = execute(project, { runs: { type: { kind: 'value', schema: { type: 'array' } } }, coverage: { type: { kind: 'value', schema: { type: 'object' } } } })
      r.payload.inputs = {
        written: { kind: 'value', value: { files: [], suite: { levels, drivers: { source: 'drivers/source.mjs' }, conventions: '' } } },
        source: { kind: 'externalResource', ref: { provider: 'git', type: 'repository', id: 'src', locator: { path: source }, version: index.commit } },
        sourceIndex: { kind: 'value', value: index },
      }
      return r
    }
    const r = await stdio('parity-run', withInputs({ app: level, records: { ...level, run: 'false' } }), project)
    expect(r.result.outputs.runs.value).toEqual([{ level: 'app', command: ['env', `PERSIMMON_SOURCE=${source}`, 'PERSIMMON_TARGET=source', 'sh', '-c', 'node suite.mjs'], exitCode: 1, head: index.commit, tests: [{ name: 'test_EP1_GD1_a', status: 'passed' }, { name: 'test_EP1_b', status: 'failed' }], observations: { test_EP1_GD1_a: { total: '1.00' }, reset: true } }])
    expect(r.result.outputs.coverage.value).toEqual({ files: { 'A.java': { 2: { hits: 3 }, 3: { hits: 0 } } }, unmapped: [] })
    const none = await stdio('parity-run', withInputs({ records: level }), project)
    expect([none.result.outputs.runs.value, none.result.outputs.coverage.value]).toEqual([[], { files: {}, unmapped: [] }]) // nothing runs on the source: the Oracle will be static
    const outside = await stdio('parity-run', withInputs({ app: { ...level, junit: '../elsewhere.xml' } }), project)
    expect(outside.error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inside the workspace') })

    // a reset that fails leaves the data unknown: the level does not run, and the run says why
    const badReset = await stdio('parity-run', withInputs({ app: { ...level, reset: 'echo cannot reset; exit 3' } }), project)
    expect(badReset.result.outputs.runs.value).toEqual([{ level: 'app', command: ['env', `PERSIMMON_SOURCE=${source}`, 'PERSIMMON_TARGET=source', 'sh', '-c', 'echo cannot reset; exit 3'], exitCode: 3, head: index.commit, tests: [], observations: {}, reason: 'reset exited 3: the level did not run', outputTail: 'cannot reset' }])

    // a suite that writes no report says so, with the output's tail
    const silent = await stdio('parity-run', withInputs({ app: { ...level, reset: undefined, run: 'echo nothing here' } }), project)
    expect(silent.result.outputs.runs.value[0]).toMatchObject({ tests: [], reason: 'no test read from build/app.xml', outputTail: 'nothing here' })

    // what the run had as a secret never reaches the ledger through an observation
    const secret = withInputs({ app: { ...level, reset: undefined, run: `node suite.mjs; node -e "require('fs').writeFileSync('build/app.json', JSON.stringify({ test_EP1_GD1_a: { token: process.env.GITHUB_TOKEN } }))"` } })
    secret.payload.credentials = { 'github-token': 'ghp-very-secret' } // the runner hands it to the suite as GITHUB_TOKEN
    const leaked = await stdio('parity-run', secret, project)
    expect(leaked.result.outputs.runs.value[0].observations).toEqual({ test_EP1_GD1_a: { token: '[redacted]' } })
    expect(JSON.stringify(leaked.result.outputs)).not.toContain('ghp-very-secret')

    // the checkout changed since it was indexed, or no project workspace: refused before anything runs
    writeFileSync(join(source, 'A.java'), 'class A {}\n')
    const moved = await stdio('parity-run', withInputs({ app: level }), project)
    expect(moved.error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('A.java changed') })
    const noWorkspace = withInputs({ app: level })
    delete noWorkspace.payload.workspace
    expect((await stdio('parity-run', noWorkspace, project)).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('action.workspace names the project') })
  })

  it('run-mutants: a patch rerun on a scratch clone is killed, survives, or is invalid; the checkout is never touched', async () => {
    const source = realpathSync(mkdtempSync(join(tmpdir(), 'parity-mut-src-')))
    git(source, 'init', '-q')
    // the item is line 2; line 20 looks alike, where git apply would land a hunk whose header lies
    const lines = ['class A {', '  int f(int x) { if (x > 0) return 1; return 0; }', ...Array.from({ length: 17 }, (_, i) => `  // ${i}`), '  int g(int y) { if (y > 0) return 1; return 0; }', '}']
    writeFileSync(join(source, 'A.java'), `${lines.join('\n')}\n`)
    git(source, 'add', 'A.java')
    git(source, 'commit', '-qm', 'a')
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'parity-mut-prj-')))
    // one test: green while the source still says `x > 0`; its name comes in PERSIMMON_TEST; it writes its own JUnit report
    writeFileSync(join(project, 'one.mjs'), [
      "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
      'const name = process.argv[2]',
      "if (name !== process.env.PERSIMMON_TEST) process.exit(9)",
      "const ok = readFileSync(process.env.PERSIMMON_SOURCE + '/A.java', 'utf8').includes('x > 0')",
      "mkdirSync('build', { recursive: true })",
      "writeFileSync('build/app.xml', `<testsuite><testcase name=\"${name}\">${ok ? '' : '<failure message=\"x\"/>'}</testcase></testsuite>`)",
    ].join('\n'))
    const index = indexSource(source, project)
    const level = { tool: 'node', run: 'node one.mjs test_EP1_GD1_positive', one: "node one.mjs '{test}'", junit: 'build/app.xml', observations: 'build/app.json', testDir: '.' } // quoted, as a suite naturally writes it
    const inventory = { source: { commit: index.commit }, guards: [{ id: 'GD-1', condition: 'x > 0', outcome: '1', role: 'rule', where: ['A.java:2'], in: ['EP-1'] }], declarations: [], stateChanges: [], externalSystems: [] }
    const engineSocket = join(realpathSync(mkdtempSync(join(tmpdir(), 'parity-mut-eng-'))), 'engine.sock')
    const server = createServer((req, res) => {
      req.resume().on('end', () => res.setHeader('content-type', 'application/json').end(JSON.stringify({ result: { spec: { content: inventory } } })))
    })
    await new Promise<void>((r) => server.listen(engineSocket, r))
    const flip = (from: string, to: string, at = 2) => ['--- a/A.java', '+++ b/A.java', `@@ -${at},1 +${at},1 @@`, `-  int f(int x) { if (x > 0) return 1; return 0; }`.replace('x > 0', from), `+  int f(int x) { if (${to}) return 1; return 0; }`].join('\n')
    const request = (mutants: unknown[], reset?: string) => {
      const r: any = execute(project, { mutantResults: { type: { kind: 'value', schema: { type: 'array' } } } })
      r.payload.engine = { endpoint: `unix://${engineSocket}`, token: 'ct-1' }
      r.payload.inputs = {
        written: { kind: 'value', value: { files: [], suite: { levels: { app: { ...level, ...(reset ? { reset } : {}) } }, drivers: { source: 'd.mjs' }, conventions: '' } } },
        source: { kind: 'externalResource', ref: { provider: 'git', type: 'repository', id: 'src', locator: { path: source }, version: index.commit } },
        sourceIndex: { kind: 'value', value: index },
        inventory: { kind: 'artifact', ref: { apiVersion: 'rewrite.persimmon.ai/v1', kind: 'SourceInventory', namespace: 'demo', id: 'inv', revision: 1 } },
        runs: { kind: 'value', value: [{ level: 'app', tests: [{ name: 'test_EP1_GD1_positive', status: 'passed' }], observations: {} }] },
        mutants: { kind: 'value', value: mutants },
      }
      return r
    }
    try {
      const lookalike = ['--- a/A.java', '+++ b/A.java', '@@ -2,1 +2,1 @@', '-  int g(int y) { if (y > 0) return 1; return 0; }', '+  int g(int y) { if (y <= 0) return 1; return 0; }'].join('\n')
      const out = await stdio('parity-run', request([
        { ref: 'GD-1', patch: flip('x > 0', 'x <= 0') },
        { ref: 'GD-1', patch: flip('x > 0', 'x > 0 ') }, // still says `x > 0`: the test cannot tell
        { ref: 'GD-1', patch: flip('x > 0', 'x <= 0', 1) }, // the hunk is off the item's line
        { ref: 'GD-1', patch: flip('x > 0', 'x <= 0').replace(/^\+(.*)return 1/m, '+$1throw new Error()') }, // the added line crashes
        { ref: 'GD-1', patch: flip('x < 7', 'x <= 0') }, // removes a line the file does not have
        { ref: 'GD-1', patch: lookalike }, // its header says line 2, git apply lands it on line 20
      ]), project)
      expect(out.result.outputs.mutantResults.value).toEqual([
        { ref: 'GD-1', result: 'killed', failed: ['test_EP1_GD1_positive'] },
        { ref: 'GD-1', result: 'survived', failed: [] },
        { ref: 'GD-1', result: 'invalid', failed: [], reason: "the patch changes A.java:1, outside the item's where" },
        { ref: 'GD-1', result: 'invalid', failed: [], reason: 'the patch adds a crash, which mutant-rules forbid: int f(int x) { if (x <= 0) throw new Error(); return 0; }' },
        { ref: 'GD-1', result: 'invalid', failed: [], reason: expect.stringContaining('the patch does not apply') },
        { ref: 'GD-1', result: 'invalid', failed: [], reason: "the patch changes A.java:20, outside the item's where" },
      ])
      expect(git(source, 'status', '--porcelain')).toBe('') // the checkout itself never changed
      expect(existsSync(join(project, '.persimmon', 'scratch', 'r-index'))).toBe(false) // the scratch clone is gone

      const noReset = await stdio('parity-run', request([{ ref: 'GD-1', patch: flip('x > 0', 'x <= 0') }], 'exit 4'), project)
      expect(noReset.result.outputs.mutantResults.value).toEqual([{ ref: 'GD-1', result: 'invalid', failed: [], reason: "the level's reset exited 4: a rerun on data it could not restore proves nothing" }])
    } finally {
      server.close()
    }
  })

  // a fake engine: getArtifact by id, putBlob and publishArtifact answered as the engine would
  const engine = async (artifacts: Record<string, unknown>, published: any[]) => {
    const sock = join(realpathSync(mkdtempSync(join(tmpdir(), 'parity-eng-'))), 'engine.sock')
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c)).on('end', () => {
        const name = req.url!.split('/').pop()
        const args = JSON.parse(body || '{}')
        const result = name === 'getArtifact' ? { spec: { content: artifacts[args.id] } } : name === 'putBlob' ? { digest: `sha256:${'a'.repeat(64)}` } : name === 'publishArtifact' ? (published.push(args), { ...args.kind, namespace: 'demo', id: args.id, revision: 4 }) : {}
        res.setHeader('content-type', 'application/json').end(JSON.stringify({ result }))
      })
    })
    await new Promise<void>((r) => server.listen(sock, r))
    return { endpoint: `unix://${sock}`, close: () => server.close() }
  }
  const ref = (kind: string, id: string, revision: number) => ({ kind: 'artifact', ref: { apiVersion: 'rewrite.persimmon.ai/v1', kind, namespace: 'demo', id, revision } })

  it('run-rewrite: runs every level on the rewrite, told so and given the TestHarness\'s start command', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'parity-rw-prj-')))
    writeFileSync(join(project, 'suite.mjs'), [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "mkdirSync('build', { recursive: true })",
      'const ok = process.env.PERSIMMON_TARGET === "rewrite" && process.env.PERSIMMON_REWRITE_START === "npm start"',
      "writeFileSync(`build/${process.argv[2]}.xml`, `<testsuite><testcase name=\"test_EP1_${process.argv[2]}\">${ok ? '' : '<failure/>'}</testcase></testsuite>`)",
      "writeFileSync(`build/${process.argv[2]}.json`, JSON.stringify({ [`test_EP1_${process.argv[2]}`]: { on: process.env.PERSIMMON_TARGET } }))",
    ].join('\n'))
    const level = (name: string) => ({ tool: 'node', run: `node suite.mjs ${name}`, one: 'node suite.mjs {test}', junit: `build/${name}.xml`, observations: `build/${name}.json`, testDir: '.' })
    const eng = await engine({ harness: { architecture: 'a', levels: {}, app: { start: 'npm start', ready: 'http://localhost:8080/health' } }, bare: { architecture: 'a', levels: {} } }, [])
    const harness = (id: string) => ({ kind: 'artifact', ref: { apiVersion: 'sdd.persimmon.ai/v1', kind: 'TestHarness', namespace: 'demo', id, revision: 1 } })
    const run = (levels: Record<string, unknown>, h?: unknown) => {
      const r: any = execute(project, { runs: { type: { kind: 'value', schema: { type: 'array' } } } })
      r.payload.engine = { endpoint: eng.endpoint, token: 'ct-1' }
      r.payload.inputs = { written: { kind: 'value', value: { files: [], suite: { levels, drivers: { source: 's' }, conventions: '' } } }, ...(h ? { harness: h } : {}) }
      return stdio('parity-run', r, project)
    }
    try {
      const out = await run({ app: level('app'), units: level('units'), records: level('records') }, harness('harness'))
      expect(out.result.outputs.runs.value.map((x: any) => [x.level, x.tests, x.observations])).toEqual([
        ['app', [{ name: 'test_EP1_app', status: 'passed' }], { test_EP1_app: { on: 'rewrite' } }],
        ['units', [{ name: 'test_EP1_units', status: 'passed' }], { test_EP1_units: { on: 'rewrite' } }], // through the rewrite's driver to its code
        ['records', [{ name: 'test_EP1_records', status: 'passed' }], { test_EP1_records: { on: 'rewrite' } }],
      ])
      expect(out.result.outputs.runs.value[0].head).toBeUndefined() // the project is no git repository: no commit to name

      const failedReset = await run({ app: { ...level('app'), reset: 'echo restoring; exit 3' } }, harness('harness'))
      expect(failedReset.result.outputs.runs.value).toEqual([expect.objectContaining({ level: 'app', exitCode: 3, tests: [], reason: 'reset exited 3: the level did not run', outputTail: 'restoring' })])

      expect((await run({ app: level('app') })).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('inputs.harness') })
      expect((await run({ app: level('app') }, harness('bare'))).error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('app.start and app.ready') })
      expect((await run({ app: { ...level('app'), reset: ' ' } }, harness('harness'))).error).toMatchObject({ code: 'invalid_input', message: "suite level app's reset is no command" })

      // a commit names what ran only when no tracked file differs from it
      const g = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: project, encoding: 'utf8' }).trim()
      g('init', '-q'); g('add', 'suite.mjs'); g('commit', '-qm', 'suite')
      expect((await run({ app: level('app') }, harness('harness'))).result.outputs.runs.value[0].head).toBe(g('rev-parse', 'HEAD'))
      writeFileSync(join(project, 'suite.mjs'), `${readFileSync(join(project, 'suite.mjs'), 'utf8')}\n// changed`)
      expect((await run({ app: level('app') }, harness('harness'))).result.outputs.runs.value[0].head).toBeUndefined()
    } finally {
      eng.close()
    }
  })

  it('compute-ledger: publishes the ledger\'s next revision, pinned to the inventory and rules revisions it read', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'parity-cl-prj-')))
    const published: any[] = []
    const eng = await engine({ 'jpetstore-inventory': named('jpetstore-inventory.r2'), 'jpetstore-parity': named('jpetstore-parity.r1'), 'jpetstore-rules': { title: 'r', owner: 'o', rules: [] } }, published)
    try {
      const r: any = execute(undefined, { ledger: { type: { kind: 'artifact', artifactKind: { apiVersion: 'rewrite.persimmon.ai/v1', kind: 'ParityLedger' } } } })
      r.payload.task.outputIds = { ledger: 'jpetstore-parity' }
      r.payload.task.outputSchemas = { ledger: { type: 'object' } } // the engine sends the frozen content schema of every artifact output
      r.payload.engine = { endpoint: eng.endpoint, token: 'ct-1' }
      r.payload.inputs = {
        inventory: ref('SourceInventory', 'jpetstore-inventory', 2), ledger: ref('ParityLedger', 'jpetstore-parity', 1), rules: ref('BusinessRules', 'jpetstore-rules', 3),
        slice: { kind: 'value', value: 'SL-1' }, decisions: { kind: 'value', value: { plumbing: ['PP-1'] } }, runs: { kind: 'value', value: [] },
      }
      const out = await stdio('parity-run', r, project)
      expect(out.error?.message).toBeUndefined()
      expect(out.result.outputs.ledger).toMatchObject({ kind: 'artifact', ref: { id: 'jpetstore-parity', revision: 4 } })
      expect(published[0].content).toMatchObject({ inventory: { id: 'jpetstore-inventory', revision: 2 }, rules: { id: 'jpetstore-rules', revision: 3 }, slice: 'SL-1', decisions: { plumbing: ['PP-1'] }, verdict: { result: 'fail' } }) // no rule recovered yet: every guard open

      const refused = async (change: (r: any) => void) => {
        const again: any = structuredClone(r)
        change(again)
        return (await stdio('parity-run', again, project)).error
      }
      expect(await refused((x) => delete x.payload.task.outputIds)).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('outputIds.ledger') })
      expect(await refused((x) => (x.payload.inputs.slice.value = 'SL-9'))).toMatchObject({ code: 'invalid_input', message: "SL-9 is no Slice of the last ledger's cut" })
      expect(await refused((x) => (x.payload.inputs.ledger = { kind: 'value', value: {} }))).toMatchObject({ code: 'invalid_input', message: 'inputs.ledger is wired but no artifact' })
      expect(await refused((x) => (x.payload.task.outputs.runs = { type: { kind: 'value', schema: { type: 'array' } } }))).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('one of sourceIndex, ledger, runs or mutantResults') })
    } finally {
      eng.close()
    }
  })

  it('refuses a Task with no workspace, or one that asks for another output', async () => {
    const noWorkspace = await stdio('parity-run', execute(undefined, asks))
    expect(noWorkspace.error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('action.workspace') })
    const other = await stdio('parity-run', execute(tmpdir(), { report: { type: { kind: 'value', schema: { type: 'object' } } } }))
    expect(other.error).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('answers a sourceIndex output') })
  })
})
