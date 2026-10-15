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

const unquote = (s) => s.trim().replace(/^["`[]|["`\]]$/g, '')

/** `CREATE TABLE [IF NOT EXISTS] [schema.]name`, the last segment unquoted; comments stripped first. */
const tables = (sql) => {
  const bare = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  const ident = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[\\w$]+)'
  const re = new RegExp(`\\bcreate\\s+(?:(?:temp|temporary|unlogged)\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${ident}(?:\\s*\\.\\s*${ident})*)`, 'gi')
  const out = []
  for (const m of bare.matchAll(re)) out.push(unquote(m[1].split('.').pop()))
  return out
}

/** `{names}` the document declares, or `{error}` when it cannot be read; `undefined` for a mediaType this reads nothing from. */
export function contractNames(document) {
  const { mediaType, content = '' } = document ?? {}
  try {
    switch (mediaType) {
      case 'application/openapi+yaml': {
        const doc = parse(content) ?? {}
        return { names: Object.entries(doc.paths ?? {}).flatMap(([path, item]) => methods.filter((m) => item && typeof item === 'object' && m in item).map((m) => `${m.toUpperCase()} ${path}`)) }
      }
      case 'application/asyncapi+yaml': {
        const doc = parse(content) ?? {}
        return { names: Object.entries(doc.channels ?? {}).flatMap(([name, ch]) => [name, ...Object.keys(ch?.messages ?? {})]) }
      }
      case 'application/schema+json': {
        const doc = JSON.parse(content)
        const defs = doc?.$defs ?? doc?.definitions
        return { names: defs && typeof defs === 'object' ? Object.keys(defs) : typeof doc?.title === 'string' ? [doc.title] : [] }
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
