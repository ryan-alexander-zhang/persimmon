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
  const run = (cwd: string, ...argv: string[]) => runCli(argv, { cwd, out: (l) => out.push(l), err: (l) => err.push(l) })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-new-test-'))
    out = []
    err = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('copies the Scaffold without its context template, renames package, group and artifactId, moves the package directories, skips target/, and inits inside (42-scaffold.md)', { timeout: 30_000 }, async () => {
    expect([await run(dir, 'new', 'order-service', '--lang', 'java', '--framework', 'ddd', '--group', 'com.acme', '--from', fixture), err]).toEqual([0, []])
    const p = join(dir, 'order-service')
    expect(out[0]).toBe('wrote 8 files into order-service (com.acme:order-service, package com.acme.orderservice)')
    expect(readFileSync(join(p, 'pom.xml'), 'utf8')).toContain('<groupId>com.acme</groupId>\n  <artifactId>order-service</artifactId>\n  <name>order-service</name>')
    expect(readFileSync(join(p, 'start/pom.xml'), 'utf8')).toContain('<parent><artifactId>order-service</artifactId></parent>\n  <artifactId>order-service-start</artifactId>')
    expect(readFileSync(join(p, 'ordering/ordering-domain/src/main/java/com/acme/orderservice/ordering/domain/Order.java'), 'utf8')).toMatch(/^package com\.acme\.orderservice\.ordering\.domain;/)
    expect(readFileSync(join(p, 'start/src/test/java/com/acme/orderservice/ArchitectureTest.java'), 'utf8')).toContain('packages = "com.acme.orderservice"')
    expect(readFileSync(join(p, 'start/src/main/resources.yaml'), 'utf8')).toBe('spring:\n  application:\n    name: ordering\n') // the sample context keeps its name
    expect(existsSync(join(p, '_context'))).toBe(false)
    expect(existsSync(join(p, 'ordering/target'))).toBe(false)
    expect(existsSync(join(p, 'ordering/ordering-domain/src/main/java/com/example'))).toBe(false)
    // init ran inside: the project is a persimmon project
    expect(existsSync(join(p, 'persimmon.yaml'))).toBe(true)
    expect(existsSync(join(p, 'AGENTS.md'))).toBe(true)
    expect(readFileSync(join(p, '.gitignore'), 'utf8')).toContain('.persimmon/')
  })

  it('defaults the group to the Scaffold\'s and derives the package from the directory name', async () => {
    expect(await run(dir, 'new', 'shop', '--lang', 'java', '--framework', 'ddd', '--from', fixture)).toBe(0)
    expect(existsSync(join(dir, 'shop/ordering/ordering-domain/src/main/java/com/example/shop/ordering/domain/Order.java'))).toBe(true)
  })

  it('--context adds an empty context from the template under the project\'s coordinates and registers it in both poms', async () => {
    expect(await run(dir, 'new', 'shop', '--lang', 'java', '--framework', 'ddd', '--group', 'com.acme', '--from', fixture)).toBe(0)
    const p = join(dir, 'shop')
    out = []
    expect([await run(p, 'new', '--context', 'inventory', '--from', fixture), err]).toEqual([0, []])
    expect(out).toEqual(['added context inventory (3 files); pom.xml lists it and start depends on inventory-infrastructure and inventory-adapter'])
    expect(readFileSync(join(p, 'inventory/pom.xml'), 'utf8')).toContain('<parent><groupId>com.acme</groupId><artifactId>shop</artifactId></parent>\n  <artifactId>inventory</artifactId>\n  <modules><module>inventory-domain</module></modules>')
    expect(readFileSync(join(p, 'inventory/inventory-domain/src/main/java/com/acme/shop/inventory/domain/package-info.java'), 'utf8')).toBe('/** The domain layer of the inventory bounded context. */\npackage com.acme.shop.inventory.domain;\n')
    expect(readFileSync(join(p, 'pom.xml'), 'utf8')).toContain('    <module>ordering</module>\n    <module>inventory</module>\n    <!-- contexts -->\n    <module>start</module>')
    expect(readFileSync(join(p, 'start/pom.xml'), 'utf8')).toContain('    <dependency>\n      <groupId>com.acme</groupId>\n      <artifactId>inventory-infrastructure</artifactId>\n      <version>${project.version}</version>\n    </dependency>\n    <dependency>\n      <groupId>com.acme</groupId>\n      <artifactId>inventory-adapter</artifactId>\n      <version>${project.version}</version>\n    </dependency>\n    <!-- contexts -->')
    // a second time: the directory exists
    expect(await run(p, 'new', '--context', 'inventory', '--from', fixture)).toBe(1)
    expect(err.at(-1)).toMatch(/inventory\/ exists/)
  })

  it('refuses an unknown pair, a missing flag, a bad group, a bad directory name, a non-empty directory, a bad context name and a directory that is no project, before writing anything', async () => {
    const refused = async (cwd: string, ...argv: string[]) => {
      err = []
      const code = await run(cwd, 'new', ...argv)
      return [code, err.join('\n')] as const
    }
    expect(await refused(dir, 'x', '--lang', 'kotlin', '--framework', 'ddd', '--from', fixture)).toEqual([1, expect.stringMatching(/--lang java --framework ddd.*"kotlin\/ddd"/)])
    expect(await refused(dir, 'x', '--lang', 'java', '--from', fixture)).toEqual([1, expect.stringMatching(/--lang and --framework are required/)])
    expect(await refused(dir, 'x', '--lang', 'java', '--framework', 'ddd', '--group', 'Com.Acme', '--from', fixture)).toEqual([1, expect.stringMatching(/Java package name/)])
    expect(await refused(dir, 'Order_Service', '--lang', 'java', '--framework', 'ddd', '--from', fixture)).toEqual([1, expect.stringMatching(/artifactId/)])
    mkdirSync(join(dir, 'taken'))
    writeFileSync(join(dir, 'taken/README.md'), 'mine')
    expect(await refused(dir, 'taken', '--lang', 'java', '--framework', 'ddd', '--from', fixture)).toEqual([1, expect.stringMatching(/not empty/)])
    expect(await refused(dir, 'x', '--lang', 'java', '--framework', 'ddd', '--from', join(dir, 'nowhere'))).toEqual([1, expect.stringMatching(/no Scaffold at/)])
    expect(await refused(dir, '--context', 'Inventory', '--from', fixture)).toEqual([1, expect.stringMatching(/package segment/)])
    expect(await refused(dir, '--context', 'inventory', '--from', fixture)).toEqual([1, expect.stringMatching(/not a project made by persimmon new/)])
    expect(existsSync(join(dir, 'x'))).toBe(false)
    expect(existsSync(join(dir, 'inventory'))).toBe(false)
  })
})
