package com.acme.persimmon.demo.tenantprovisioning.domain.biz.event;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEventType;
import java.time.Instant;
import java.util.UUID;

@DomainEventType("harbor.project.ready.v1")
public record HarborProjectReadyEvent(
    UUID eventId, Instant occurredAt, UUID workflowInstanceId, UUID tenantId) implements DomainEvent {
  public HarborProjectReadyEvent {
    DomainEvent.validate(eventId, occurredAt);
  }
}

