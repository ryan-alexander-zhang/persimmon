import { formatErrors, validator } from './ajv.js'
import type { Resource } from './types.js'

export class EnvelopeError extends Error {}

const envelope = validator<Resource>('resource.yaml')

/** Envelope stage of the write order (00-resource.md): shape only, spec left to the kind's schema. */
export function validateEnvelope(value: unknown): Resource {
  if (!envelope(value)) throw new EnvelopeError(formatErrors(envelope.errors))
  return value
}
