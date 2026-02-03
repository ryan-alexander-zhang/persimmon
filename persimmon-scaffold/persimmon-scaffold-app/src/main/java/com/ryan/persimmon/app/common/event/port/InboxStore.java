package com.ryan.persimmon.app.common.event.port;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import java.time.Instant;
import java.util.UUID;

/** Inbox (idempotency) store for consumed integration events. */
public interface InboxStore {
  /**
   * Tries to start processing the event for the given consumer.
   *
   * <p>This must be implemented as an atomic claim (typically via a unique key on {@code
   * (consumerName, eventId)}), to avoid concurrent double-processing.
   *
   * @return true if the caller successfully claimed the right to process the event.
   */
  boolean tryStart(ConsumedEvent event, String consumerName, Instant startedAt);

  /** Marks a previously started event as processed. */
  void markProcessed(UUID eventId, String consumerName, Instant processedAt);

  /** Marks a previously started event as failed (so it can be retried). */
  void markFailed(UUID eventId, String consumerName, Instant failedAt, String lastError);
}
