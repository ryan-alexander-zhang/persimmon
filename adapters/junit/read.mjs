// Reading JUnit XML for junit/v1 (35-build-process.md); apart from index.mjs so tests import it without starting the Adapter.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'

/** `junit` inside the workspace and not the workspace itself, so deleting stale reports never reaches the project's other files. */
export function reportPath(workspace, junit) {
  const at = resolve(workspace, junit)
  const rel = relative(resolve(workspace), at)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${junit} must name a file or directory inside the workspace`)
  return at
}

/** A JUnit report: its root element is `testsuites` or `testsuite`, after any declaration and comments. */
export const isReport = (file) => /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<testsuites?[\s>/]/.test(readFileSync(file, 'utf8').slice(0, 4096))

/** The files `junit` names: the file, or every `.xml` directly in the directory (surefire, gradle). */
export function reports(workspace, junit) {
  const at = reportPath(workspace, junit)
  if (!existsSync(at)) return []
  return statSync(at).isDirectory() ? readdirSync(at).filter((f) => f.endsWith('.xml')).sort().map((f) => join(at, f)) : [at]
}

const list = (nodes) => Array.from({ length: nodes.length }, (_, i) => nodes.item(i))

/** Every `<testcase>` of one report, under a `<testsuites>` or a `<testsuite>` root; throws on XML that does not parse. A case without a name takes its classname. */
export function testCases(xml) {
  const doc = new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message) } }).parseFromString(xml, 'text/xml')
  return list(doc.getElementsByTagName('testcase')).map((tc) => {
    const first = (tag) => list(tc.getElementsByTagName(tag))[0]
    const failure = first('failure')
    const error = first('error')
    const status = failure ? 'failed' : error ? 'errored' : first('skipped') ? 'skipped' : 'passed'
    const message = (failure ?? error)?.getAttribute('message') || (failure ?? error)?.textContent?.trim().split('\n')[0]
    const classname = tc.getAttribute('classname') ?? ''
    return { classname, name: tc.getAttribute('name') || classname || '(unnamed)', status, ...(message ? { message } : {}) }
  })
}
