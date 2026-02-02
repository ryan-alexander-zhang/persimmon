package com.ryan.persimmon.app.common.outbox;

import static org.junit.jupiter.api.Assertions.*;

import com.ryan.persimmon.app.common.outbox.model.DomainEventContext;
import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.port.OutboxPayloadSerializer;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.app.common.outbox.service.DomainEventOutboxService;
import com.ryan.persimmon.domain.common.event.DomainEvent;
import com.ryan.persimmon.domain.common.event.HasDomainEvents;
import com.ryan.persimmon.domain.common.id.UuidV7Id;
import com.ryan.persimmon.domain.common.model.AggregateRoot;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DomainEventOutboxServiceTest {

  @Test
  void recordPulledDomainEvents_should_append_messages_and_clear_events() {
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f92");
    TestAggregate aggregate = new TestAggregate(new TestAggregateId(aggregateId));

    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f93");
    Instant occurredAt = Instant.parse("2026-02-02T00:00:00Z");
    TestEvent event = new TestEvent(eventId, occurredAt, "hello");
    aggregate.raiseTest(event);

    CapturingOutboxStore store = new CapturingOutboxStore();
    OutboxPayloadSerializer serializer = e -> "payload:" + ((TestEvent) e).payload();
    DomainEventOutboxService service = new DomainEventOutboxService(store, serializer);

    DomainEventContext ctx =
        new DomainEventContext("TestAggregate", aggregateId, Map.of("traceId", "t-1"));

    service.recordPulledDomainEvents(aggregate, ctx);

    assertEquals(1, store.appended.size());
    OutboxMessage msg = store.appended.getFirst();
    assertEquals(eventId, msg.eventId());
    assertEquals(occurredAt, msg.occurredAt());
    assertEquals("TestAggregate", msg.aggregateType());
    assertEquals(aggregateId, msg.aggregateId());
    assertEquals(TestEvent.class.getName(), msg.eventType());
    assertEquals("payload:hello", msg.payload());
    assertEquals(Map.of("traceId", "t-1"), msg.headers());
    assertEquals(0, msg.attempts());

    // events must be cleared after pull
    assertTrue(aggregate.peekDomainEvents().isEmpty());

    // second recording should be a no-op
    service.recordPulledDomainEvents(aggregate, ctx);
    assertEquals(1, store.appended.size());
  }

  @Test
  void recordPulledDomainEvents_should_noop_when_no_events() {
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f94");
    TestAggregate aggregate = new TestAggregate(new TestAggregateId(aggregateId));
    CapturingOutboxStore store = new CapturingOutboxStore();
    DomainEventOutboxService service = new DomainEventOutboxService(store, e -> "{}");

    service.recordPulledDomainEvents(aggregate, DomainEventContext.of("TestAggregate", aggregateId));

    assertTrue(store.appended.isEmpty());
  }

  private static final class CapturingOutboxStore implements OutboxStore {
    private final List<OutboxMessage> appended = new ArrayList<>();

    @Override
    public void append(List<OutboxMessage> messages) {
      appended.addAll(messages);
    }

    @Override
    public List<OutboxMessage> claimNextBatch(int batchSize, Instant now) {
      throw new UnsupportedOperationException("not needed for this test");
    }

    @Override
    public void markSent(UUID eventId, Instant sentAt) {
      throw new UnsupportedOperationException("not needed for this test");
    }

    @Override
    public void markFailed(UUID eventId, Instant now, Instant nextRetryAt, String lastError) {
      throw new UnsupportedOperationException("not needed for this test");
    }

    @Override
    public void markDead(UUID eventId, Instant now, String lastError) {
      throw new UnsupportedOperationException("not needed for this test");
    }
  }

  private static final class TestAggregate extends AggregateRoot<TestAggregateId> {
    private TestAggregate(TestAggregateId id) {
      super(id);
    }

    void raiseTest(DomainEvent event) {
      raise(event);
    }
  }

  private static final class TestAggregateId extends UuidV7Id {
    private TestAggregateId(UUID value) {
      super(value);
    }
  }

  private record TestEvent(UUID eventId, Instant occurredAt, String payload) implements DomainEvent {
    private TestEvent {
      DomainEvent.validate(eventId, occurredAt);
    }
  }
}

