// The names a Design's document declares, per mediaType (29-design-process.md): what `elements[]` must index, both ways.
// Nothing deeper is read: a parse failure is one finding, and the index is checked against names alone.
import { parse } from 'yaml'

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** `## <screen>` headings of a ui Design's markdown, fenced code skipped (CommonMark: a fence closes on its own marker, at least as long). */
export const screens = (markdown) => {
  const out = []
  let fence
  for (const line of markdown.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (m && !fence) fence = m[1]
    else if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = undefined
    else if (!fence && /^ {0,3}## /.test(line)) out.push(line.replace(/^ {0,3}## /, '').replace(/\s+#+\s*$/, '').trim())
  }
  return out
}

/** SQL without its string literals and comments, one pass left to right: a `--` inside a literal is text, an apostrophe inside a comment is prose. */
export const bareSql = (sql) => sql.replace(/'(?:[^']|'')*'|\/\*[\s\S]*?\*\/|--[^\n]*/g, (m) => (m[0] === "'" ? "''" : ' '))

const ident = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[\\w$]+)'
const unquote = (s) => s.trim().replace(/^["`[]|["`\]]$/g, '')

/** `CREATE [OR REPLACE] [TEMP|VIRTUAL|...] TABLE [IF NOT EXISTS] [schema.]name`: the last identifier, unquoted. Views and indexes are not tables. */
const tables = (sql) => {
  const re = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:(?:global\\s+|local\\s+)?(?:temp|temporary|unlogged|virtual)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${ident}(?:\\s*\\.\\s*${ident})*)`, 'gi')
  const out = []
  for (const m of bareSql(sql).matchAll(re)) out.push(unquote(m[1].match(new RegExp(ident, 'g')).pop()))
  return out
}

/** A local `$ref` (`#/a/b`) resolved against the document, else the node itself. */
const deref = (doc, node) => {
  const ref = node && typeof node === 'object' && typeof node.$ref === 'string' && node.$ref.startsWith('#/') ? node.$ref : undefined
  return ref ? ref.slice(2).split('/').reduce((o, k) => (o && typeof o === 'object' ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), doc) : node
}

/** `{names}` the document declares, or `{error}` when it cannot be read; `undefined` for a mediaType this reads nothing from. */
export function contractNames(document) {
  const { mediaType, content = '' } = document ?? {}
  try {
    switch (mediaType) {
      case 'application/openapi+yaml': {
        const doc = parse(content) ?? {}
        return { names: Object.entries(doc.paths ?? {}).flatMap(([path, raw]) => { const item = deref(doc, raw); return methods.filter((m) => item && typeof item === 'object' && m in item).map((m) => `${m.toUpperCase()} ${path}`) }) } // webhooks are not paths
      }
      case 'application/asyncapi+yaml': {
        const doc = parse(content) ?? {}
        if (!/^3\./.test(String(doc.asyncapi ?? ''))) return { error: `asyncapi ${doc.asyncapi ?? 'absent'}: AsyncAPI 3 only` }
        return { names: Object.entries(doc.channels ?? {}).flatMap(([name, raw]) => [name, ...Object.keys(deref(doc, raw)?.messages ?? {})]) }
      }
      case 'application/schema+json': {
        const doc = JSON.parse(content)
        const defs = doc?.$defs ?? doc?.definitions
        const keys = defs && typeof defs === 'object' ? Object.keys(defs) : []
        return { names: keys.length ? keys : typeof doc?.title === 'string' ? [doc.title] : [] }
      }
      case 'application/sql':
        return { names: tables(content) }
      case 'text/markdown':
        return { names: screens(content) }
      default:
        return undefined
    }
  } catch (e) {
    return { error: e.message.split('\n')[0] }
  }
}
