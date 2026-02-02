package com.ryan.persimmon.app.common.outbox.retry;

import java.time.Duration;

/**
 * Exponential backoff retry policy.
 *
 * <p>Backoff = min(maxBackoff, baseBackoff * 2^(attempt-1))
 */
public final class ExponentialBackoffRetryPolicy implements RetryPolicy {
  private final Duration baseBackoff;
  private final Duration maxBackoff;

  public ExponentialBackoffRetryPolicy(Duration baseBackoff, Duration maxBackoff) {
    this.baseBackoff = baseBackoff;
    this.maxBackoff = maxBackoff;
  }

  @Override
  public Duration nextBackoff(int nextAttempt) {
    if (nextAttempt <= 1) {
      return baseBackoff;
    }
    long factor = 1L << Math.min(30, nextAttempt - 1);
    Duration backoff = baseBackoff.multipliedBy(factor);
    return backoff.compareTo(maxBackoff) > 0 ? maxBackoff : backoff;
  }
}

