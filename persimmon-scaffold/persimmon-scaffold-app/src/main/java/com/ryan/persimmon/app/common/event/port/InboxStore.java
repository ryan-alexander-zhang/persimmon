package com.ryan.persimmon.app.common.event.port;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import java.time.Instant;
import java.util.UUID;

/** Inbox (idempotency) store for consumed integration events. */
public interface InboxStore {
  boolean isProcessed(UUID eventId, String consumerName);

  void markProcessed(ConsumedEvent event, String consumerName, Instant processedAt);
}
