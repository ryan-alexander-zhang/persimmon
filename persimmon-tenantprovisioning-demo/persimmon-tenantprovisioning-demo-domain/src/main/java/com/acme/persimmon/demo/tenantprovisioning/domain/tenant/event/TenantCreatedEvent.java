package com.acme.persimmon.demo.tenantprovisioning.domain.tenant.event;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEventType;
import java.time.Instant;
import java.util.UUID;

@DomainEventType("tenant.tenant-created.v1")
public record TenantCreatedEvent(UUID eventId, Instant occurredAt, UUID tenantId, String email)
    implements DomainEvent {
  public TenantCreatedEvent {
    DomainEvent.validate(eventId, occurredAt);
  }
}
