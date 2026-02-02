package com.ryan.persimmon.app.common.outbox.service;

import static org.junit.jupiter.api.Assertions.*;

import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.app.common.outbox.port.OutboxTransport;
import com.ryan.persimmon.app.common.outbox.retry.ExponentialBackoffRetryPolicy;
import com.ryan.persimmon.app.common.outbox.retry.RetryPolicy;
import com.ryan.persimmon.app.common.time.AppClock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OutboxRelayServiceTest {

  @Test
  void relayOnce_should_mark_sent_when_transport_succeeds() {
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f95");
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    MutableClock clock = new MutableClock(t0);
    InMemoryOutboxStore store = new InMemoryOutboxStore(clock);
    store.append(List.of(message(eventId, t0)));

    OutboxTransport ok = m -> {};
    RetryPolicy retryPolicy = new ExponentialBackoffRetryPolicy(Duration.ofSeconds(1), Duration.ofSeconds(10));

    OutboxRelayService relay = new OutboxRelayService(store, ok, retryPolicy, clock, 3);
    relay.relayOnce(10);

    InMemoryOutboxStore.Row row = store.get(eventId);
    assertEquals("SENT", row.status);
    assertNotNull(row.sentAt);
    assertNull(row.nextRetryAt);
    assertEquals(0, row.attempts);
  }

  @Test
  void relayOnce_should_retry_until_success_and_respect_nextRetryAt() {
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f96");
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    MutableClock clock = new MutableClock(t0);
    InMemoryOutboxStore store = new InMemoryOutboxStore(clock);
    store.append(List.of(message(eventId, t0)));

    FlakyTransport flaky = new FlakyTransport(2); // fail twice, then succeed
    RetryPolicy retryPolicy = new ExponentialBackoffRetryPolicy(Duration.ofSeconds(5), Duration.ofSeconds(60));
    OutboxRelayService relay = new OutboxRelayService(store, flaky, retryPolicy, clock, 10);

    // 1st attempt: fail -> READY with nextRetryAt=t0+5, attempts=1
    relay.relayOnce(10);
    InMemoryOutboxStore.Row row1 = store.get(eventId);
    assertEquals("READY", row1.status);
    assertEquals(1, row1.attempts);
    assertEquals(t0.plusSeconds(5), row1.nextRetryAt);

    // Not due yet -> should not be claimed
    clock.set(t0.plusSeconds(4));
    relay.relayOnce(10);
    assertEquals(1, store.get(eventId).attempts);
    assertEquals("READY", store.get(eventId).status);

    // 2nd attempt at due time: fail -> READY with nextRetryAt=now+10, attempts=2
    clock.set(t0.plusSeconds(5));
    relay.relayOnce(10);
    InMemoryOutboxStore.Row row2 = store.get(eventId);
    assertEquals("READY", row2.status);
    assertEquals(2, row2.attempts);
    assertEquals(t0.plusSeconds(15), row2.nextRetryAt); // 5 + 10

    // 3rd attempt at due time: succeed -> SENT
    clock.set(t0.plusSeconds(15));
    relay.relayOnce(10);
    InMemoryOutboxStore.Row row3 = store.get(eventId);
    assertEquals("SENT", row3.status);
    assertNotNull(row3.sentAt);
    assertEquals(2, row3.attempts);
  }

  @Test
  void relayOnce_should_mark_dead_after_max_attempts() {
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f97");
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    MutableClock clock = new MutableClock(t0);
    InMemoryOutboxStore store = new InMemoryOutboxStore(clock);
    store.append(List.of(message(eventId, t0)));

    OutboxTransport alwaysFail = m -> {
      throw new RuntimeException("boom");
    };
    RetryPolicy retryPolicy = new ExponentialBackoffRetryPolicy(Duration.ofSeconds(1), Duration.ofSeconds(1));
    OutboxRelayService relay = new OutboxRelayService(store, alwaysFail, retryPolicy, clock, 3);

    // Fail 1 -> READY, attempts=1, nextRetryAt=t0+1
    relay.relayOnce(10);
    assertEquals("READY", store.get(eventId).status);
    assertEquals(1, store.get(eventId).attempts);

    // Fail 2 -> READY, attempts=2, nextRetryAt=t0+2
    clock.set(t0.plusSeconds(1));
    relay.relayOnce(10);
    assertEquals("READY", store.get(eventId).status);
    assertEquals(2, store.get(eventId).attempts);

    // Fail 3 -> DEAD (maxAttempts=3), attempts=3
    clock.set(t0.plusSeconds(2));
    relay.relayOnce(10);
    InMemoryOutboxStore.Row row = store.get(eventId);
    assertEquals("DEAD", row.status);
    assertEquals(3, row.attempts);
    assertNotNull(row.deadAt);
    assertNull(row.nextRetryAt);
  }

  private static OutboxMessage message(UUID eventId, Instant occurredAt) {
    return new OutboxMessage(
        eventId,
        occurredAt,
        "Agg",
        UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115f98"),
        "Event",
        "{}",
        Map.of(),
        0);
  }

  private static final class MutableClock implements AppClock {
    private Instant now;

    private MutableClock(Instant now) {
      this.now = now;
    }

    void set(Instant now) {
      this.now = now;
    }

    @Override
    public Instant now() {
      return now;
    }
  }

  private static final class FlakyTransport implements OutboxTransport {
    private int remainingFailures;

    private FlakyTransport(int failures) {
      this.remainingFailures = failures;
    }

    @Override
    public void publish(OutboxMessage message) {
      if (remainingFailures > 0) {
        remainingFailures--;
        throw new RuntimeException("fail");
      }
    }
  }

  /**
   * Minimal in-memory outbox store to validate the end-to-end app-layer flow (record -> claim ->
   * publish -> mark).
   *
   * <p>Implements READY/SENDING/SENT/DEAD semantics and nextRetryAt gating.
   */
  private static final class InMemoryOutboxStore implements OutboxStore {
    private final List<Row> rows = new ArrayList<>();
    private final AppClock clock;

    private InMemoryOutboxStore(AppClock clock) {
      this.clock = clock;
    }

    @Override
    public void append(List<OutboxMessage> messages) {
      for (OutboxMessage message : messages) {
        rows.add(Row.from(message, "READY"));
      }
    }

    @Override
    public List<OutboxMessage> claimNextBatch(int batchSize, Instant now) {
      // release expired locks not modeled; keep behavior minimal.
      return rows.stream()
          .filter(r -> r.status.equals("READY"))
          .filter(r -> r.nextRetryAt == null || !r.nextRetryAt.isAfter(now))
          .sorted(Comparator.comparing(r -> r.occurredAt))
          .limit(batchSize)
          .peek(r -> r.status = "SENDING")
          .map(Row::toMessage)
          .toList();
    }

    @Override
    public void markSent(UUID eventId, Instant sentAt) {
      Row row = get(eventId);
      row.status = "SENT";
      row.sentAt = sentAt;
      row.lastError = null;
      row.nextRetryAt = null;
    }

    @Override
    public void markFailed(UUID eventId, Instant now, Instant nextRetryAt, String lastError) {
      Row row = get(eventId);
      row.status = "READY";
      row.attempts += 1;
      row.nextRetryAt = nextRetryAt;
      row.lastError = lastError;
    }

    @Override
    public void markDead(UUID eventId, Instant now, String lastError) {
      Row row = get(eventId);
      row.status = "DEAD";
      row.attempts += 1;
      row.nextRetryAt = null;
      row.deadAt = now;
      row.lastError = lastError;
    }

    private Row get(UUID eventId) {
      return rows.stream()
          .filter(r -> r.eventId.equals(eventId))
          .findFirst()
          .orElseThrow(() -> new AssertionError("row not found: " + eventId));
    }

    private static final class Row {
      private final UUID eventId;
      private final Instant occurredAt;
      private final String aggregateType;
      private final UUID aggregateId;
      private final String eventType;
      private final String payload;
      private final Map<String, String> headers;

      private String status;
      private int attempts;
      private Instant nextRetryAt;
      private Instant sentAt;
      private Instant deadAt;
      private String lastError;

      private Row(
          UUID eventId,
          Instant occurredAt,
          String aggregateType,
          UUID aggregateId,
          String eventType,
          String payload,
          Map<String, String> headers,
          String status,
          int attempts) {
        this.eventId = eventId;
        this.occurredAt = occurredAt;
        this.aggregateType = aggregateType;
        this.aggregateId = aggregateId;
        this.eventType = eventType;
        this.payload = payload;
        this.headers = headers;
        this.status = status;
        this.attempts = attempts;
      }

      private static Row from(OutboxMessage message, String status) {
        return new Row(
            message.eventId(),
            message.occurredAt(),
            message.aggregateType(),
            message.aggregateId(),
            message.eventType(),
            message.payload(),
            message.headers(),
            status,
            message.attempts());
      }

      private OutboxMessage toMessage() {
        return new OutboxMessage(
            eventId, occurredAt, aggregateType, aggregateId, eventType, payload, headers, attempts);
      }
    }
  }
}

