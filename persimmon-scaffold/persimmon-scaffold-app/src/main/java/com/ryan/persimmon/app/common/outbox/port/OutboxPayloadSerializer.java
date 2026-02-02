package com.ryan.persimmon.app.common.outbox.port;

import com.ryan.persimmon.domain.common.event.DomainEvent;

/** Serializes a domain event to an outbox payload. */
public interface OutboxPayloadSerializer {
  String serialize(DomainEvent event);
}
