package com.ryan.persimmon.app.common.outbox.model;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Application-level outbox message model. */
public record OutboxMessage(
    UUID eventId,
    Instant occurredAt,
    String aggregateType,
    UUID aggregateId,
    String eventType,
    String payload,
    Map<String, String> headers,
    int attempts) {
  public OutboxMessage {
    headers = headers == null ? Map.of() : Map.copyOf(headers);
  }
}
