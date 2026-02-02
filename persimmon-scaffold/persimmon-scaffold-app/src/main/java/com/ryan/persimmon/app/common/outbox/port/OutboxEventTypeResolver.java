package com.ryan.persimmon.app.common.outbox.port;

import com.ryan.persimmon.domain.common.event.DomainEvent;

/** Resolves a stable event type string for an outbox message. */
public interface OutboxEventTypeResolver {
  String resolve(DomainEvent event);
}
