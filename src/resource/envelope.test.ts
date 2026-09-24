import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { validator } from './ajv.js'
import { EnvelopeError, validateEnvelope } from './envelope.js'

const example = (name: string) => parse(readFileSync(`docs/design/examples/${name}.yaml`, 'utf8'))

describe('validateEnvelope', () => {
  it.each(['resource-namespaced', 'resource-global', 'resource-child'])('accepts %s', (n) => {
    expect(validateEnvelope(example(n)).kind).toBeTypeOf('string')
  })

  it('rejects a missing spec', () => {
    const r = example('resource-global')
    delete r.spec
    expect(() => validateEnvelope(r)).toThrow(EnvelopeError)
  })

  it('rejects an unknown metadata key', () => {
    const r = example('resource-global')
    r.metadata.owner = 'x'
    expect(() => validateEnvelope(r)).toThrow(/metadata/)
  })

  it('rejects a second ownerReference', () => {
    const r = example('resource-child')
    r.metadata.ownerReferences.push(r.metadata.ownerReferences[0])
    expect(() => validateEnvelope(r)).toThrow(/ownerReferences/)
  })

  it('rejects an uppercase name', () => {
    const r = example('resource-global')
    r.metadata.name = 'Prompts'
    expect(() => validateEnvelope(r)).toThrow(/name/)
  })
})

describe('reference shapes', () => {
  const refs = example('resource-refs')
  it.each([
    ['objectRef', 'ObjectRef'],
    ['localDefinitionRef', 'LocalDefinitionRef'],
    ['revisionRef', 'RevisionRef'],
    ['externalResourceRef', 'ExternalResourceRef'],
  ])('%s matches $defs/%s', (key, def) => {
    expect(validator('resource.yaml', `/$defs/${def}`)(refs[key])).toBe(true)
  })

  it('audit record matches $defs/AuditRecord', () => {
    expect(validator('resource.yaml', '/$defs/AuditRecord')(example('resource-audit'))).toBe(true)
  })
})
