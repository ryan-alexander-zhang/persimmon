package com.ryan.persimmon.app.common.outbox.service;

import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.app.common.outbox.port.OutboxTransport;
import com.ryan.persimmon.app.common.outbox.retry.RetryPolicy;
import com.ryan.persimmon.app.common.time.AppClock;
import java.time.Instant;
import java.util.List;

/** Polls the outbox table and publishes messages to the configured transport. */
public class OutboxRelayService {
  private final OutboxStore outboxStore;
  private final OutboxTransport outboxTransport;
  private final RetryPolicy retryPolicy;
  private final AppClock clock;
  private final int maxAttempts;

  public OutboxRelayService(
      OutboxStore outboxStore,
      OutboxTransport outboxTransport,
      RetryPolicy retryPolicy,
      AppClock clock,
      int maxAttempts) {
    this.outboxStore = outboxStore;
    this.outboxTransport = outboxTransport;
    this.retryPolicy = retryPolicy;
    this.clock = clock;
    this.maxAttempts = maxAttempts;
  }

  public void relayOnce(int batchSize) {
    Instant now = clock.now();
    List<OutboxMessage> batch = outboxStore.claimNextBatch(batchSize, now);
    for (OutboxMessage message : batch) {
      try {
        outboxTransport.publish(message);
        outboxStore.markSent(message.eventId(), clock.now());
      } catch (Exception e) {
        int nextAttempt = message.attempts() + 1;
        String lastError =
            e.getClass().getName() + ": " + (e.getMessage() == null ? "" : e.getMessage());
        if (nextAttempt >= maxAttempts) {
          outboxStore.markDead(message.eventId(), now, lastError);
        } else {
          Instant nextRetryAt = now.plus(retryPolicy.nextBackoff(nextAttempt));
          outboxStore.markFailed(message.eventId(), now, nextRetryAt, lastError);
        }
      }
    }
  }
}
