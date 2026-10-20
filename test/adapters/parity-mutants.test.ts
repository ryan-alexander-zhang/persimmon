// What a mutant is, decided without running it (40-pack-rewrite.md): a diff within its item's where that adds no crash and no
// file, and a result read from the tests citing the item. One case per escape a review found.
import { describe, expect, it } from 'vitest'
import { diffFault, mutantResult, parseDiff, patchFault } from '../../adapters/parity/mutants.mjs'

const svc = 'src/main/java/org/mybatis/jpetstore/service/CatalogService.java'
const flip = [`--- a/${svc}`, `+++ b/${svc}`, '@@ -151,3 +151,3 @@', '   Item item = itemMapper.getItem(itemId);', '-  return inventory > 0;', '+  return inventory <= 0;', ' }'].join('\n')
const where = [`${svc}:151-153`]

describe('parseDiff', () => {
  it('reads each hunk\'s old start and count and the lines it adds', () => {
    expect(parseDiff(flip)).toEqual([{ path: svc, created: false, deleted: false, renamed: false, binary: false, hunks: [{ oldStart: 151, oldCount: 3, added: ['  return inventory <= 0;'] }] }])
  })

  it('never takes a removed line starting with "-- " for a header: the hunk\'s counts decide', () => {
    const sql = ['--- a/q.sql', '+++ b/q.sql', '@@ -2,2 +2,0 @@', '--- a comment', '-SELECT 1;', '--- a/other.sql', '+++ b/other.sql', '@@ -9 +9 @@', '-x', '+y'].join('\n')
    expect(parseDiff(sql).map((f) => [f.path, f.hunks.map((h) => [h.oldStart, h.oldCount])])).toEqual([['q.sql', [[2, 2]]], ['other.sql', [[9, 1]]]])
  })

  it('marks a created, deleted, renamed or binary file', () => {
    const git = ['diff --git a/x.java b/x.java', 'new file mode 100644', '--- /dev/null', '+++ b/x.java', '@@ -0,0 +1 @@', '+class X {}', 'diff --git a/a.png b/a.png', 'Binary files a/a.png and b/a.png differ', 'diff --git a/o.java b/n.java', 'rename from o.java', 'rename to n.java'].join('\n')
    expect(parseDiff(git).map((f) => [f.created, f.binary, f.renamed])).toEqual([[true, false, false], [false, true, false], [false, false, true]])
  })
})

describe('patchFault', () => {
  it('accepts a patch that changes the item\'s lines only', () => {
    expect(patchFault(flip, where)).toBeUndefined()
  })

  it('refuses a hunk outside the where, an insertion outside it, a second file, a created file, and a patch that changes nothing', () => {
    expect(patchFault(flip.replace('@@ -151,3 +151,3 @@', '@@ -160,3 +160,3 @@'), where)).toBe(`the patch changes ${svc}:160-162, outside the item's where`)
    expect(patchFault(`${flip}\n@@ -400,0 +401,2 @@\n+  // anything\n+  void stub() {}`, where)).toBe(`the patch changes ${svc}:400, outside the item's where`)
    expect(patchFault(`${flip}\n--- a/pom.xml\n+++ b/pom.xml\n@@ -40,0 +41,1 @@\n+<dependency/>`, where)).toBe("the patch changes pom.xml:40, outside the item's where")
    expect(patchFault(`${flip}\n--- /dev/null\n+++ b/src/test/Stub.java\n@@ -0,0 +1 @@\n+class Stub {}`, where)).toMatch(/creates src\/test\/Stub.java/)
    expect(patchFault('', where)).toBe('the patch changes no line of the source')
  })

  it('refuses a file changed without a changed line, as a mode change rides along', () => {
    const chmod = `${flip}\ndiff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755`
    expect(patchFault(chmod, where)).toBe("the patch changes run.sh without changing a line (its mode, say): a mutant changes the item's lines only")
  })

  it('refuses an added crash, by a list the auditor completes', () => {
    for (const crash of ['throw new IllegalStateException();', 'STOP RUN.', 'return 1/0;', 'assert false;', 'while (true) {}', 'int[] a = new int[-1];', 'System.exit(1);'])
      expect({ crash, fault: patchFault(flip.replace('return inventory <= 0;', crash), where) }).toEqual({ crash, fault: expect.stringMatching(/adds a crash/) })
    expect(patchFault(flip.replace('return inventory <= 0;', 'return inventory >= 0;'), where)).toBeUndefined()
  })

  it('an insertion right after the span\'s last line, or before its first, is inside it', () => {
    expect(diffFault([{ path: svc, created: false, deleted: false, renamed: false, binary: false, hunks: [{ oldStart: 153, oldCount: 0, added: ['x'] }, { oldStart: 150, oldCount: 0, added: ['y'] }] }], where)).toBeUndefined()
  })
})

describe('mutantResult', () => {
  const before = ['test_EP2_GD2_in_stock', 'test_EP2_GD2_out', 'test_EP2_other']
  it('killed by a test citing the item, green on the source, failing on an assertion', () => {
    expect(mutantResult('GD-2', [{ name: 'test_EP2_GD2_in_stock', status: 'failed' }, { name: 'test_EP2_GD2_out', status: 'passed' }], before)).toEqual({ ref: 'GD-2', result: 'killed', failed: ['test_EP2_GD2_in_stock'] })
  })

  it('survived when every citing test still passes, even if a test not citing it failed', () => {
    expect(mutantResult('GD-2', [{ name: 'test_EP2_GD2_in_stock', status: 'passed' }, { name: 'test_EP2_other', status: 'failed' }], before)).toEqual({ ref: 'GD-2', result: 'survived', failed: [] })
  })

  it('invalid when no citing test ran to an answer, or none green on the source cites it', () => {
    expect(mutantResult('GD-2', [{ name: 'test_EP2_GD2_in_stock', status: 'errored' }], before)).toMatchObject({ result: 'invalid', reason: expect.stringContaining('did not build or start') })
    expect(mutantResult('GD-2', [{ name: 'test_EP2_GD2_new', status: 'failed' }], before)).toMatchObject({ result: 'invalid', reason: 'no test green on the source cites it' })
  })
})
