package com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.service;

import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.model.DomainEventContext;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.model.OutboxMessage;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.port.OutboxEventTypeResolver;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.port.OutboxPayloadSerializer;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.port.OutboxStore;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.HasDomainEvents;
import java.util.ArrayList;
import java.util.List;

/** Records uncommitted domain events to the outbox table (in the same business transaction). */
public class DomainEventOutboxService {
  private final OutboxStore outboxStore;
  private final OutboxPayloadSerializer payloadSerializer;
  private final OutboxEventTypeResolver eventTypeResolver;

  public DomainEventOutboxService(
      OutboxStore outboxStore,
      OutboxPayloadSerializer payloadSerializer,
      OutboxEventTypeResolver eventTypeResolver) {
    this.outboxStore = outboxStore;
    this.payloadSerializer = payloadSerializer;
    this.eventTypeResolver = eventTypeResolver;
  }

  public void recordPulledDomainEvents(HasDomainEvents aggregate, DomainEventContext context) {
    List<DomainEvent> events = aggregate.pullDomainEvents();
    if (events.isEmpty()) {
      return;
    }

    List<OutboxMessage> messages = new ArrayList<>(events.size());
    for (DomainEvent event : events) {
      messages.add(
          new OutboxMessage(
              event.eventId(),
              event.occurredAt(),
              context.aggregateType(),
              context.aggregateId(),
              eventTypeResolver.resolve(event),
              payloadSerializer.serialize(event),
              context.headers(),
              0));
    }
    outboxStore.append(messages);
  }
}
