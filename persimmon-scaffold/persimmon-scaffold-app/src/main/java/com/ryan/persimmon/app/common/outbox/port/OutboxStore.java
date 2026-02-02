package com.ryan.persimmon.app.common.outbox.port;

import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Outbox persistence port.
 *
 * <p>This is an application-level port. Implementations are wired in the start module and may
 * delegate to infra.
 */
public interface OutboxStore {

  /** Appends new outbox messages as {@code READY}. Must run in the business transaction. */
  void append(List<OutboxMessage> messages);

  /**
   * Claims a batch of messages for sending.
   *
   * <p>Implementations should ensure at-most-one relay worker claims a message at a time (e.g., row
   * locks + status update).
   */
  List<OutboxMessage> claimNextBatch(int batchSize, Instant now);

  void markSent(UUID eventId, Instant sentAt);

  void markFailed(UUID eventId, Instant now, Instant nextRetryAt, String lastError);

  void markDead(UUID eventId, Instant now, String lastError);
}
