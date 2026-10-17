// Reading JUnit XML for junit/v1 (35-build-process.md); apart from index.mjs so tests import it without starting the Adapter.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'

/** The reports `junit` names in the workspace: the file, or every `.xml` directly in the directory (surefire, gradle). */
export function reports(workspace, junit) {
  const at = resolve(workspace, junit)
  if (!existsSync(at)) return []
  return statSync(at).isDirectory() ? readdirSync(at).filter((f) => f.endsWith('.xml')).sort().map((f) => join(at, f)) : [at]
}

const list = (nodes) => Array.from({ length: nodes.length }, (_, i) => nodes.item(i))

/** Every `<testcase>` of one report, under a `<testsuites>` or a `<testsuite>` root; throws on XML that does not parse. */
export function testCases(xml) {
  const doc = new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message) } }).parseFromString(xml, 'text/xml')
  return list(doc.getElementsByTagName('testcase')).map((tc) => {
    const first = (tag) => list(tc.getElementsByTagName(tag))[0]
    const failure = first('failure')
    const error = first('error')
    const status = failure ? 'failed' : error ? 'errored' : first('skipped') ? 'skipped' : 'passed'
    const message = (failure ?? error)?.getAttribute('message') || (failure ?? error)?.textContent?.trim().split('\n')[0]
    return { classname: tc.getAttribute('classname') ?? '', name: tc.getAttribute('name') ?? '', status, ...(message ? { message } : {}) }
  })
}
