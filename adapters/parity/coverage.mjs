// Coverage of the Source system's own code, whole repository, by line (40-pack-rewrite.md): a JaCoCo or Cobertura XML or an
// lcov report read into `{<path>: {<line>: {hits, branches?: {covered, total}}}}` with paths the source index's, mapped by a
// unique path suffix. Not junit/v1's measure.mjs: that one counts the Change set's lines; this one says which lines ran.
import { DOMParser } from '@xmldom/xmldom'

const list = (nodes) => Array.from({ length: nodes.length }, (_, i) => nodes.item(i))

/** The report's own paths: `{<path>: {<line>: {hits, branches?}}}`; the format read off its first bytes. */
export function readCoverage(text) {
  if (!text.trim()) throw new Error('the coverage report is empty: the run wrote no coverage')
  const files = {}
  const line = (path, n, hits, branches) => {
    const lines = files[path] ?? (files[path] = {})
    const was = lines[n]
    lines[n] = { hits: Math.max(hits, was?.hits ?? 0), ...(branches || was?.branches ? { branches: branches ?? was.branches } : {}) }
  }
  if (/^\s*(TN:|SF:)/m.test(text) && !text.trimStart().startsWith('<')) {
    let path
    const branches = {}
    for (const raw of text.split(/\r?\n/)) {
      const [tag, rest = ''] = raw.split(/:(.*)/s)
      if (tag === 'SF') path = rest.trim()
      else if (tag === 'DA' && path) {
        const [n, hits] = rest.split(',')
        line(path, Number(n), Number(hits))
      } else if (tag === 'BRDA' && path) {
        const [n, , , taken] = rest.split(',')
        const b = (branches[`${path}:${n}`] ??= { covered: 0, total: 0 })
        b.total++
        if (taken !== '-' && Number(taken) > 0) b.covered++
      } else if (tag === 'end_of_record') path = undefined
    }
    for (const [key, b] of Object.entries(branches)) {
      const at = key.lastIndexOf(':')
      const [path, n] = [key.slice(0, at), Number(key.slice(at + 1))]
      line(path, n, files[path]?.[n]?.hits ?? 0, b)
    }
    return files
  }
  const doc = new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message) } }).parseFromString(text, 'text/xml')
  const root = doc.documentElement?.nodeName
  if (root === 'report') {
    for (const pkg of list(doc.getElementsByTagName('package'))) {
      const dir = pkg.getAttribute('name')
      for (const sf of list(pkg.getElementsByTagName('sourcefile'))) {
        const path = dir ? `${dir}/${sf.getAttribute('name')}` : sf.getAttribute('name')
        for (const l of list(sf.getElementsByTagName('line'))) {
          const [mb, cb] = [Number(l.getAttribute('mb') || 0), Number(l.getAttribute('cb') || 0)]
          line(path, Number(l.getAttribute('nr')), Number(l.getAttribute('ci') || 0), mb + cb ? { covered: cb, total: mb + cb } : undefined)
        }
      }
    }
    return files
  }
  if (root === 'coverage') {
    for (const c of list(doc.getElementsByTagName('class'))) {
      const path = c.getAttribute('filename')
      for (const l of list(c.getElementsByTagName('line'))) {
        const cc = /\((\d+)\/(\d+)\)/.exec(l.getAttribute('condition-coverage') ?? '')
        line(path, Number(l.getAttribute('number')), Number(l.getAttribute('hits') || 0), /^true$/i.test(l.getAttribute('branch') ?? '') && cc ? { covered: Number(cc[1]), total: Number(cc[2]) } : undefined)
      }
    }
    return files
  }
  throw new Error('neither a JaCoCo, a Cobertura nor an lcov report')
}

/** The report's paths as the source index names them: the indexed file the report's path ends with, or that ends with it,
 * when exactly one does (JaCoCo's `org/x/A.java` under `src/main/java/`, Cobertura's paths under a `<source>`, lcov's
 * absolute paths). `unmapped` lists a report path no indexed file matches, or several do: counting it nowhere would
 * pass the guards it ran as never reached. */
export function mapCoverage(report, indexFiles) {
  const paths = Object.keys(indexFiles)
  const files = {}
  const unmapped = []
  for (const [reported, lines] of Object.entries(report)) {
    const tail = reported.replace(/\\/g, '/').replace(/^\.?\//, '')
    const hits = Object.hasOwn(indexFiles, tail) ? [tail] : paths.filter((p) => p.endsWith(`/${tail}`) || tail.endsWith(`/${p}`))
    if (hits.length !== 1) {
      unmapped.push(reported)
      continue
    }
    // two spellings of one file in a report: a line ran if either says so
    const into = (files[hits[0]] ??= {})
    for (const [n, l] of Object.entries(lines)) into[n] = into[n] && into[n].hits >= l.hits ? into[n] : { ...l, ...(into[n]?.branches && !l.branches ? { branches: into[n].branches } : {}) }
  }
  return { files, unmapped }
}
