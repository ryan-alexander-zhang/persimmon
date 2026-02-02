package com.ryan.persimmon.app.common.outbox.model;

import java.util.Map;
import java.util.UUID;

/**
 * Context used to enrich outbox messages when recording domain events.
 *
 * <p>Domain events themselves stay minimal; aggregate information and cross-cutting metadata live
 * here.
 */
public record DomainEventContext(
    String aggregateType, UUID aggregateId, Map<String, String> headers) {
  public DomainEventContext {
    headers = headers == null ? Map.of() : Map.copyOf(headers);
  }

  public static DomainEventContext of(String aggregateType, UUID aggregateId) {
    return new DomainEventContext(aggregateType, aggregateId, Map.of());
  }
}
