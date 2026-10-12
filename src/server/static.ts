// Built tool files under `/tools/<name>/` (25-ui.md). No engine, no store: bytes only.
import { createReadStream, existsSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `dist/tools` next to the package root, wherever the binary runs from (as `src/cli/init.ts` resolves `adapters/`). */
export function toolsRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'tools')
}

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/** `<dir>/<name>/<path>`; the tool's `index.html` for its root and for any path without a file extension, so the single-page app routes. Answers false when there is nothing to send. */
export function serveStatic(dir: string, path: string, res: ServerResponse): boolean {
  const [name, ...rest] = path.split('/').filter(Boolean)
  if (!name) return false
  const base = resolve(dir, name)
  const file = extname(rest.at(-1) ?? '') ? resolve(base, ...rest) : join(base, 'index.html')
  if (file !== base && !file.startsWith(base + sep)) return false // ../ out of the tool
  if (!existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file)
    .on('error', () => res.destroy()) // a read that fails mid-way must not take the process down
    .pipe(res)
  return true
}
