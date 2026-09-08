import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { arch, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `install.sh` against a local HTTP stub standing in for the Release download
 * base. What is under test is the checksum policy of spec-00012-FR-11
 * (issue-00038): an archive whose checksum cannot be *confirmed* is never
 * installed, while a machine simply missing the checksums file or a checksum
 * tool degrades to a warning and installs. The stub needs no network, so this
 * stays in the default suite; the real Release on real linux and darwin is the
 * manual obligation plan-00033 records.
 */

const ROOT = new URL('..', import.meta.url).pathname
const SCRIPT = join(ROOT, 'install.sh')
const OS = platform() === 'darwin' ? 'darwin' : 'linux'
const ARCH = arch() === 'arm64' ? 'arm64' : 'amd64'
const ASSET = `persimmon_${OS}_${ARCH}.tar.gz`

const trash: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const dir of trash.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
})

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  trash.push(dir)
  return dir
}

/** A release archive holding one executable `persimmon`, the shape goreleaser produces. */
function archive(): { path: string; sha256: string } {
  const dir = tmp('persimmon-archive-')
  const binary = join(dir, 'persimmon')
  writeFileSync(binary, '#!/bin/sh\necho "persimmon dev"\n')
  chmodSync(binary, 0o755)
  const path = join(dir, ASSET)
  const tar = spawnSync('tar', ['-czf', path, '-C', dir, 'persimmon'], { encoding: 'utf8' })
  expect(tar.status, tar.stderr).toBe(0)
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
}

/** The Release download base: whatever is in `files` is served, anything else is a 404. */
async function downloadBase(files: Record<string, Buffer | string>): Promise<string> {
  const server = createServer((request, response) => {
    const body = files[(request.url ?? '').replace(/^\//, '')]
    if (body === undefined) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200).end(body)
  })
  servers.push(server)
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/**
 * A PATH holding every tool the script needs except the two checksum ones, which
 * is how a machine with neither `sha256sum` nor `shasum` is simulated.
 */
function pathWithoutChecksumTools(): string {
  const dir = tmp('persimmon-path-')
  for (const tool of ['uname', 'tr', 'curl', 'mktemp', 'tar', 'install', 'mkdir', 'awk', 'grep', 'cut', 'rm']) {
    const found = spawnSync('command', ['-v', tool], { shell: true, encoding: 'utf8' }).stdout.trim()
    expect(found, `${tool} is needed to run install.sh`).not.toBe('')
    symlinkSync(found, join(dir, tool))
  }
  return dir
}

/**
 * Runs the script and waits for it asynchronously: the stub server lives in this
 * process, so a synchronous spawn would block the event loop that has to answer
 * the script's own `curl`.
 */
function install(
  base: string,
  options: { path?: string } = {},
): Promise<{ status: number | null; output: string; dest: string; installed: boolean }> {
  const dest = tmp('persimmon-dest-')
  const child = spawn('/bin/sh', [SCRIPT], {
    env: {
      ...process.env,
      PERSIMMON_INSTALL_BASE_URL: base,
      PERSIMMON_INSTALL_DIR: dest,
      ...(options.path === undefined ? {} : { PATH: options.path }),
    },
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk) => (output += chunk))
  return new Promise((done) =>
    child.on('close', (status) =>
      done({ status, output, dest, installed: existsSync(join(dest, 'persimmon')) }),
    ),
  )
}

describe('install.sh', () => {
  // spec-00012-AC-10.1
  it('installs the archive when its checksum matches', async () => {
    const { path, sha256 } = archive()
    const base = await downloadBase({ [ASSET]: readFileSync(path), 'checksums.txt': `${sha256}  ${ASSET}\n` })

    const run = await install(base)

    expect(run.status, run.output).toBe(0)
    expect(run.installed).toBe(true)
    expect(spawnSync(join(run.dest, 'persimmon'), { encoding: 'utf8' }).stdout).toContain('persimmon')
  })

  // spec-00012-AC-11.1
  it('aborts and installs nothing when the checksum does not match', async () => {
    const { path } = archive()
    const base = await downloadBase({ [ASSET]: readFileSync(path), 'checksums.txt': `${'0'.repeat(64)}  ${ASSET}\n` })

    const run = await install(base)

    expect(run.status).not.toBe(0)
    expect(run.installed).toBe(false)
    expect(run.output).toMatch(/checksum/i)
  })

  // spec-00012-AC-11.2
  it('aborts when the checksums file has no line for the archive', async () => {
    const { path, sha256 } = archive()
    const base = await downloadBase({
      [ASSET]: readFileSync(path),
      'checksums.txt': `${sha256}  persimmon_windows_amd64.zip\n`,
    })

    const run = await install(base)

    expect(run.status).not.toBe(0)
    expect(run.installed).toBe(false)
  })

  // spec-00012-AC-11.3
  it('aborts when the archive line is malformed', async () => {
    const { path } = archive()
    const base = await downloadBase({ [ASSET]: readFileSync(path), 'checksums.txt': `not-a-checksum  ${ASSET}\n` })

    const run = await install(base)

    expect(run.status).not.toBe(0)
    expect(run.installed).toBe(false)
  })

  // spec-00012-AC-11.4
  it('warns and installs when the checksums file cannot be fetched', async () => {
    const { path } = archive()
    const base = await downloadBase({ [ASSET]: readFileSync(path) })

    const run = await install(base)

    expect(run.status, run.output).toBe(0)
    expect(run.installed).toBe(true)
    expect(run.output).toMatch(/warning/i)
  })

  // spec-00012-AC-11.5
  it('warns and installs when the machine has neither sha256sum nor shasum', async () => {
    const { path, sha256 } = archive()
    const base = await downloadBase({ [ASSET]: readFileSync(path), 'checksums.txt': `${sha256}  ${ASSET}\n` })

    const run = await install(base, { path: pathWithoutChecksumTools() })

    expect(run.status, run.output).toBe(0)
    expect(run.installed).toBe(true)
    expect(run.output).toMatch(/warning/i)
  })
})
