package com.acme.persimmon.demo.tenantprovisioning.app.common.event.model;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Inbound integration event envelope (already deserialized to primitives + payload string). */
public record ConsumedEvent(
    UUID eventId,
    String eventType,
    Instant occurredAt,
    String aggregateType,
    UUID aggregateId,
    String payload,
    Map<String, String> headers) {
  public ConsumedEvent {
    headers = headers == null ? Map.of() : Map.copyOf(headers);
  }
}
