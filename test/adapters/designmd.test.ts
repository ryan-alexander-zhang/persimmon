// The DESIGN.md evaluator Adapter over stdio (19-adapter-roles.md, 32-ui-design-process.md): describe, the official
// linter's findings mapped to a ValidationResult, failOnWarning, content that is not a DesignSystem.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')

const designMd = `---
name: Room Booking
colors:
  primary: "#1A1C1E"
  on-primary: "#FFFFFF"
  surface: "#F7F5F2"
typography:
  body-md:
    fontFamily: Public Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  md: 16px
rounded:
  md: 8px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
---

## Overview

Calm and legible at a glance.

## Colors

Ink on limestone.

## Typography

Public Sans throughout.

## Layout

An 8px scale.

## Elevation & Depth

Flat; borders carry hierarchy.

## Shapes

8px corners.

## Components

One primary button.

## Do's and Don'ts

- Do keep one primary action per screen
`
const provenance = { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', name: 'dm-001' }, inputs: [], actor: { kind: 'handler', id: 'test' } }
const payload = (content: unknown, configuration: Record<string, unknown> = {}) => ({
  validationRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'ValidationRun', name: 'dm-001' }, logicalExecutionId: 'dm-001//designSystem', idempotencyKey: 'dm-001//designSystem/1' },
  validator: { configuration },
  inputs: {},
  artifacts: { designSystem: { content, provenance } },
  deadline: new Date(Date.now() + 60_000).toISOString(),
  engine: { endpoint: 'unix:///nowhere.sock', token: 'ct-1' },
})
const system = (document: string) => ({ title: 'Room Booking', prd: 'room-booking-prd', document: { mediaType: 'text/markdown', content: document }, decisions: [], openQuestions: [] })

function adapter(req: unknown) {
  return new Promise<{ ok: boolean; result?: any; error?: any }>((resolve) => {
    const child = spawn(process.execPath, [join(root, 'adapters', 'designmd', 'index.mjs')])
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => process.stderr.write(c))
    child.on('close', () => resolve(JSON.parse(out.trim().split('\n').at(-1)!)))
    child.stdin.end(JSON.stringify(req) + '\n')
  })
}

describe('designmd/v1', () => {
  it('describes the evaluator Role', async () => {
    const d = await adapter({ id: 1, op: 'describe', payload: {} })
    expect(d).toEqual({ id: 1, ok: true, result: { adapterId: 'designmd/v1', protocol: 'persimmon.adapter/v1', roles: ['evaluator'], configurationSchema: { type: 'object', additionalProperties: false, properties: { failOnWarning: { type: 'boolean' } } } } })
  })

  it('passes a DESIGN.md the linter accepts, with its infos as findings', async () => {
    const r = await adapter({ id: 2, op: 'evaluate', payload: payload(system(designMd), { failOnWarning: true }) })
    expect(r.ok).toBe(true)
    expect(r.result.passed).toBe(true)
    expect(r.result.findings.map((f: any) => [f.severity, f.code])).toEqual([['info', 'token-summary']])
    expect(r.result.evidence).toEqual([])
  })

  it('fails a broken token reference, and a warning only when failOnWarning', async () => {
    const broken = designMd.replace('"{colors.on-primary}"', '"{colors.ghost}"')
    const r = await adapter({ id: 3, op: 'evaluate', payload: payload(system(broken)) })
    expect(r.result.passed).toBe(false)
    expect(r.result.findings.find((f: any) => f.severity === 'error')).toMatchObject({ code: 'broken-ref', message: expect.stringContaining('colors.ghost') })
    const swapped = designMd.replace('## Overview\n\nCalm and legible at a glance.\n\n## Colors\n\nInk on limestone.', '## Colors\n\nInk on limestone.\n\n## Overview\n\nCalm and legible at a glance.')
    const lenient = await adapter({ id: 4, op: 'evaluate', payload: payload(system(swapped)) })
    expect(lenient.result.passed).toBe(true)
    expect(lenient.result.findings.map((f: any) => [f.severity, f.code])).toContainEqual(['warning', 'section-order'])
    const strict = await adapter({ id: 5, op: 'evaluate', payload: payload(system(swapped), { failOnWarning: true }) })
    expect(strict.result.passed).toBe(false)
  })

  it('fails front matter that is absent, not a mapping, or unparsable, and keeps a code on every finding', async () => {
    const none = await adapter({ id: 8, op: 'evaluate', payload: payload(system('## Overview\n\nNo tokens.\n')) })
    expect(none.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-a-design-system', message: 'content is not a DesignSystem: its front matter defines no name and no colors' }], evidence: [] })
    const list = await adapter({ id: 9, op: 'evaluate', payload: payload(system('---\n- a\n---\n\n## Overview\n')) })
    expect(list.result.passed).toBe(false)
    expect(list.result.findings.map((f: any) => f.code)).toEqual(['not-a-design-system'])
    const bad = await adapter({ id: 10, op: 'evaluate', payload: payload(system(designMd.replace('primary: "#1A1C1E"', 'primary: notacolor'))) })
    expect(bad.result.findings.every((f: any) => typeof f.code === 'string' && f.code.length > 0)).toBe(true)
    expect(bad.result.findings.some((f: any) => f.message.includes('notacolor'))).toBe(true)
  })

  it('fails content that is not a DesignSystem, and reports nothing else', async () => {
    const r = await adapter({ id: 6, op: 'evaluate', payload: payload({ title: 'not a DesignSystem' }) })
    expect(r.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-a-design-system', message: 'content is not a DesignSystem: it has no document.content' }], evidence: [] })
    const none = await adapter({ id: 7, op: 'evaluate', payload: { ...payload(system(designMd)), artifacts: {} } })
    expect(none).toEqual({ id: 7, ok: false, error: { code: 'invalid_input', message: 'artifacts.designSystem is required', retryable: false } })
  })
})
