package com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.port;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;

/** Resolves a stable event type string for an outbox message. */
public interface OutboxEventTypeResolver {
  String resolve(DomainEvent event);
}
