package com.ryan.persimmon.app.common.outbox.service;

import com.ryan.persimmon.app.common.outbox.model.DomainEventContext;
import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.port.OutboxPayloadSerializer;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.domain.common.event.DomainEvent;
import com.ryan.persimmon.domain.common.event.HasDomainEvents;
import java.util.ArrayList;
import java.util.List;

/** Records uncommitted domain events to the outbox table (in the same business transaction). */
public class DomainEventOutboxService {
  private final OutboxStore outboxStore;
  private final OutboxPayloadSerializer payloadSerializer;

  public DomainEventOutboxService(
      OutboxStore outboxStore, OutboxPayloadSerializer payloadSerializer) {
    this.outboxStore = outboxStore;
    this.payloadSerializer = payloadSerializer;
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
              event.getClass().getName(),
              payloadSerializer.serialize(event),
              context.headers(),
              0));
    }
    outboxStore.append(messages);
  }
}
