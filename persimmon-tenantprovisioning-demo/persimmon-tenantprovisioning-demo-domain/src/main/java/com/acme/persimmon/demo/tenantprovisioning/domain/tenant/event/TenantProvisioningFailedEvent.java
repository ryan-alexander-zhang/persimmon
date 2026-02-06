package com.acme.persimmon.demo.tenantprovisioning.domain.tenant.event;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEventType;
import java.time.Instant;
import java.util.UUID;

@DomainEventType("tenant.provisioning-failed.v1")
public record TenantProvisioningFailedEvent(
    UUID eventId, Instant occurredAt, UUID tenantId, String reason) implements DomainEvent {
  public TenantProvisioningFailedEvent {
    DomainEvent.validate(eventId, occurredAt);
  }
}
