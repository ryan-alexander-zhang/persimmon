package com.ryan.persimmon.app.common.outbox.retry;

import java.time.Duration;

/** Computes retry backoff based on attempt number. */
public interface RetryPolicy {
  Duration nextBackoff(int nextAttempt);
}

