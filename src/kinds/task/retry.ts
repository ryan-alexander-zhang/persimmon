import { durationMs } from '../../config.js'
import type { ReconcileError } from '../../reconcile/types.js'
import { neverRetried, type RetryPolicy, type SideEffects } from './types.js'

/** Another attempt after attempt `index` failed with `error`? (12-task.md RetryPolicy, 17-runs.md) */
export function shouldRetry(policy: RetryPolicy | undefined, index: number, error: ReconcileError, sideEffects: SideEffects): boolean {
  if (!policy || index >= policy.maxAttempts) return false
  if (neverRetried.has(error.code)) return false
  if (error.code === 'unknown_result') return sideEffects === 'none'
  if (policy.abortOn?.includes(error.code)) return false
  if (policy.retryOn?.includes(error.code)) return true
  return error.retryable
}

/** Delay before attempt `index + 1`, in ms. */
export function backoffMs(policy: RetryPolicy, index: number, random: () => number): number {
  const initial = durationMs(policy.backoff.initial)
  const max = durationMs(policy.backoff.max)
  const raw =
    policy.backoff.strategy === 'fixed' ? initial : policy.backoff.strategy === 'linear' ? initial * index : initial * 2 ** (index - 1)
  const capped = Math.min(raw, max)
  return policy.backoff.jitter === 'full' ? Math.floor(random() * capped) : capped
}
