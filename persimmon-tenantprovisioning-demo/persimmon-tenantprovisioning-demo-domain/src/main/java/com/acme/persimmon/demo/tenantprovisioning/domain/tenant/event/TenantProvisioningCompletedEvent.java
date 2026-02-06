package com.acme.persimmon.demo.tenantprovisioning.domain.tenant.event;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEventType;
import java.time.Instant;
import java.util.UUID;

@DomainEventType("tenant.provisioning-completed.v1")
public record TenantProvisioningCompletedEvent(UUID eventId, Instant occurredAt, UUID tenantId)
    implements DomainEvent {
  public TenantProvisioningCompletedEvent {
    DomainEvent.validate(eventId, occurredAt);
  }
}
