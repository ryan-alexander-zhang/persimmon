import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from './index.js'

describe('persimmon new', () => {
  let dir: string
  let out: string[]
  let err: string[]
  const fixture = join(process.cwd(), 'test/fixtures/scaffold-java')
  const run = (...argv: string[]) => runCli(argv, { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-new-test-'))
    out = []
    err = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('copies the Scaffold, renames package, group and artifactId, moves the package directories, skips target/, and inits inside (42-scaffold.md)', { timeout: 30_000 }, async () => {
    expect([await run('new', 'order-service', '--lang', 'java', '--framework', 'ddd', '--group', 'com.acme', '--from', fixture), err]).toEqual([0, []])
    const p = join(dir, 'order-service')
    expect(out[0]).toBe('wrote 6 files into order-service (com.acme:order-service, package com.acme.orderservice)')
    expect(readFileSync(join(p, 'pom.xml'), 'utf8')).toContain('<groupId>com.acme</groupId>\n  <artifactId>order-service</artifactId>\n  <name>order-service</name>\n  <modules>\n    <module>order-service-domain</module>\n    <module>order-service-start</module>')
    expect(readFileSync(join(p, 'order-service-start/pom.xml'), 'utf8')).toContain('<parent><artifactId>order-service</artifactId></parent>\n  <artifactId>order-service-start</artifactId>\n  <dependencies><dependency><artifactId>order-service-domain</artifactId>')
    expect(readFileSync(join(p, 'order-service-domain/src/main/java/com/acme/orderservice/domain/Order.java'), 'utf8')).toMatch(/^package com\.acme\.orderservice\.domain;/)
    expect(readFileSync(join(p, 'order-service-start/src/test/java/com/acme/orderservice/ArchitectureTest.java'), 'utf8')).toContain('packages = "com.acme.orderservice"')
    expect(readFileSync(join(p, 'order-service-start/src/main/resources.yaml'), 'utf8')).toBe('spring:\n  application:\n    name: ordering\n') // the sample context keeps its name
    expect(existsSync(join(p, 'ordering-domain'))).toBe(false)
    expect(existsSync(join(p, 'order-service-domain/src/main/java/com/example'))).toBe(false)
    expect(existsSync(join(p, 'target'))).toBe(false)
    // init ran inside: the project is a persimmon project
    expect(existsSync(join(p, 'persimmon.yaml'))).toBe(true)
    expect(existsSync(join(p, 'AGENTS.md'))).toBe(true)
    expect(readFileSync(join(p, '.gitignore'), 'utf8')).toContain('.persimmon/')
    expect(out).toContain('wrote AGENTS.md')
  })

  it('defaults the group to the Scaffold\'s and derives the package from the directory name', async () => {
    expect(await run('new', 'shop', '--lang', 'java', '--framework', 'ddd', '--from', fixture)).toBe(0)
    expect(existsSync(join(dir, 'shop/shop-domain/src/main/java/com/example/shop/domain/Order.java'))).toBe(true)
  })

  it('refuses an unknown pair, a missing flag, a bad group, a bad directory name and a non-empty directory before writing anything', async () => {
    const refused = async (...argv: string[]) => {
      err = []
      const code = await run('new', ...argv)
      return [code, err.join('\n')] as const
    }
    expect(await refused('x', '--lang', 'kotlin', '--framework', 'ddd', '--from', fixture)).toEqual([1, expect.stringMatching(/--lang java --framework ddd.*"kotlin\/ddd"/)])
    expect(await refused('x', '--lang', 'java', '--from', fixture)).toEqual([1, expect.stringMatching(/--lang and --framework/)])
    expect(await refused('x', '--lang', 'java', '--framework', 'ddd', '--group', 'Com.Acme', '--from', fixture)).toEqual([1, expect.stringMatching(/Java package name/)])
    expect(await refused('Order_Service', '--lang', 'java', '--framework', 'ddd', '--from', fixture)).toEqual([1, expect.stringMatching(/artifactId/)])
    mkdirSync(join(dir, 'taken'))
    writeFileSync(join(dir, 'taken/README.md'), 'mine')
    expect(await refused('taken', '--lang', 'java', '--framework', 'ddd', '--from', fixture)).toEqual([1, expect.stringMatching(/not empty/)])
    expect(await refused('x', '--lang', 'java', '--framework', 'ddd', '--from', join(dir, 'nowhere'))).toEqual([1, expect.stringMatching(/no Scaffold at/)])
    expect(existsSync(join(dir, 'x'))).toBe(false)
  })
})
