package com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.port;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;

/** Serializes a domain event to an outbox payload. */
public interface OutboxPayloadSerializer {
  String serialize(DomainEvent event);
}
