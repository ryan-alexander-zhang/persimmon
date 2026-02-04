package com.ryan.persimmon.app.common.event.service;

import static org.junit.jupiter.api.Assertions.*;

import com.ryan.persimmon.app.common.event.exception.EventHandlingException;
import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import com.ryan.persimmon.app.common.event.port.EventHandler;
import com.ryan.persimmon.app.common.event.port.InboxStore;
import com.ryan.persimmon.app.common.time.AppClock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DefaultEventDispatcherTest {

  @Test
  void dispatch_should_be_idempotent_by_eventId_and_consumer() {
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115faa");
    ConsumedEvent event =
        new ConsumedEvent(
            eventId,
            "test.event.v1",
            t0,
            "Agg",
            UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fab"),
            "{}",
            Map.of());

    InMemoryInbox inbox = new InMemoryInbox();
    CountingHandler handler = new CountingHandler("test.event.v1");
    AppClock clock = () -> t0.plusSeconds(1);

    DefaultEventDispatcher dispatcher =
        new DefaultEventDispatcher(inbox, clock, "c1", List.of(handler));

    dispatcher.dispatch(event);
    dispatcher.dispatch(event); // duplicate

    assertEquals(1, handler.calls);
    assertTrue(inbox.isProcessed(eventId, "c1"));
  }

  @Test
  void dispatch_should_mark_dead_when_no_handler_registered() {
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fac");
    ConsumedEvent event =
        new ConsumedEvent(
            eventId,
            "missing.event.v1",
            t0,
            "Agg",
            UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fad"),
            "{}",
            Map.of());

    InMemoryInbox inbox = new InMemoryInbox();
    DefaultEventDispatcher dispatcher =
        new DefaultEventDispatcher(inbox, () -> t0, "c1", List.of());

    assertDoesNotThrow(() -> dispatcher.dispatch(event));
    assertEquals("DEAD", inbox.status(eventId, "c1"));
    assertFalse(inbox.isProcessed(eventId, "c1"));

    // repeated delivery should be ignored
    assertDoesNotThrow(() -> dispatcher.dispatch(event));
    assertEquals("DEAD", inbox.status(eventId, "c1"));
  }

  @Test
  void ctor_should_throw_on_duplicate_eventType_handlers() {
    InMemoryInbox inbox = new InMemoryInbox();
    AppClock clock = () -> Instant.parse("2026-02-02T00:00:00Z");

    EventHandler h1 = new CountingHandler("test.event.v1");
    EventHandler h2 = new CountingHandler("test.event.v1");

    assertThrows(
        IllegalStateException.class,
        () -> new DefaultEventDispatcher(inbox, clock, "c1", List.of(h1, h2)));
  }

  @Test
  void ctor_should_ignore_blank_eventType_handlers() {
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fae");
    ConsumedEvent event =
        new ConsumedEvent(
            eventId,
            "ok.event.v1",
            t0,
            "Agg",
            UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115faf"),
            "{}",
            Map.of());

    InMemoryInbox inbox = new InMemoryInbox();
    CountingHandler ignored = new CountingHandler(" ");
    CountingHandler ok = new CountingHandler("ok.event.v1");
    DefaultEventDispatcher dispatcher =
        new DefaultEventDispatcher(inbox, () -> t0, "c1", List.of(ignored, ok));

    dispatcher.dispatch(event);
    assertEquals(1, ok.calls);
  }

  @Test
  void dispatch_should_mark_failed_when_handler_throws() {
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb7");
    ConsumedEvent event =
        new ConsumedEvent(
            eventId,
            "boom.event.v1",
            t0,
            "Agg",
            UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb8"),
            "{}",
            Map.of());

    InMemoryInbox inbox = new InMemoryInbox();
    EventHandler boom =
        new EventHandler() {
          @Override
          public String eventType() {
            return "boom.event.v1";
          }

          @Override
          public void handle(ConsumedEvent event) {
            throw EventHandlingException.retryable(
                "TEMP", "boom", new IllegalStateException("boom"));
          }
        };

    DefaultEventDispatcher dispatcher = new DefaultEventDispatcher(inbox, () -> t0, "c1", List.of(boom));

    assertThrows(EventHandlingException.class, () -> dispatcher.dispatch(event));
    assertEquals("FAILED", inbox.status(eventId, "c1"));
    assertNotNull(inbox.lastError(eventId, "c1"));

    // retry should be allowed (FAILED -> PROCESSING -> FAILED)
    assertThrows(EventHandlingException.class, () -> dispatcher.dispatch(event));
    assertEquals("FAILED", inbox.status(eventId, "c1"));
  }

  @Test
  void dispatch_should_mark_dead_and_not_throw_when_handler_fails_nonRetryable() {
    Instant t0 = Instant.parse("2026-02-02T00:00:00Z");
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb9");
    ConsumedEvent event =
        new ConsumedEvent(
            eventId,
            "dead.event.v1",
            t0,
            "Agg",
            UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fba"),
            "{}",
            Map.of());

    InMemoryInbox inbox = new InMemoryInbox();
    EventHandler dead =
        new EventHandler() {
          @Override
          public String eventType() {
            return "dead.event.v1";
          }

          @Override
          public void handle(ConsumedEvent event) {
            throw EventHandlingException.nonRetryable(
                "PERM", "nope", new IllegalArgumentException("bad"));
          }
        };

    DefaultEventDispatcher dispatcher = new DefaultEventDispatcher(inbox, () -> t0, "c1", List.of(dead));

    assertDoesNotThrow(() -> dispatcher.dispatch(event));
    assertEquals("DEAD", inbox.status(eventId, "c1"));

    // repeated delivery should be ignored
    assertDoesNotThrow(() -> dispatcher.dispatch(event));
    assertEquals("DEAD", inbox.status(eventId, "c1"));
  }

  private static final class CountingHandler implements EventHandler {
    private final String type;
    private int calls = 0;

    private CountingHandler(String type) {
      this.type = type;
    }

    @Override
    public String eventType() {
      return type;
    }

    @Override
    public void handle(ConsumedEvent event) {
      calls++;
    }
  }

  private static final class InMemoryInbox implements InboxStore {
    private final List<Row> rows = new ArrayList<>();

    @Override
    public boolean tryStart(ConsumedEvent event, String consumerName, Instant startedAt) {
      Row row = find(event.eventId(), consumerName);
      if (row == null) {
        rows.add(new Row(consumerName, event.eventId(), "PROCESSING", startedAt, null));
        return true;
      }
      if ("FAILED".equals(row.status)) {
        row.status = "PROCESSING";
        row.lastError = null;
        row.processedAt = null;
        return true;
      }
      return false;
    }

    @Override
    public void markProcessed(UUID eventId, String consumerName, Instant processedAt) {
      Row row = find(eventId, consumerName);
      if (row == null) {
        throw new IllegalStateException("not started");
      }
      if (!"PROCESSING".equals(row.status)) {
        return;
      }
      row.status = "PROCESSED";
      row.processedAt = processedAt;
      row.lastError = null;
    }

    @Override
    public void markFailed(UUID eventId, String consumerName, Instant failedAt, String lastError) {
      Row row = find(eventId, consumerName);
      if (row == null) {
        throw new IllegalStateException("not started");
      }
      if (!"PROCESSING".equals(row.status)) {
        return;
      }
      row.status = "FAILED";
      row.processedAt = failedAt;
      row.lastError = lastError;
    }

    @Override
    public void markDead(UUID eventId, String consumerName, Instant deadAt, String lastError) {
      Row row = find(eventId, consumerName);
      if (row == null) {
        throw new IllegalStateException("not started");
      }
      if (!"PROCESSING".equals(row.status)) {
        return;
      }
      row.status = "DEAD";
      row.processedAt = deadAt;
      row.lastError = lastError;
    }

    private Row find(UUID eventId, String consumerName) {
      for (Row row : rows) {
        if (row.eventId.equals(eventId) && row.consumerName.equals(consumerName)) {
          return row;
        }
      }
      return null;
    }

    boolean isProcessed(UUID eventId, String consumerName) {
      Row row = find(eventId, consumerName);
      return row != null && "PROCESSED".equals(row.status);
    }

    String status(UUID eventId, String consumerName) {
      Row row = find(eventId, consumerName);
      return row == null ? null : row.status;
    }

    String lastError(UUID eventId, String consumerName) {
      Row row = find(eventId, consumerName);
      return row == null ? null : row.lastError;
    }

    private static final class Row {
      private final String consumerName;
      private final UUID eventId;
      private String status;
      private Instant processedAt;
      private String lastError;

      private Row(String consumerName, UUID eventId, String status, Instant processedAt, String lastError) {
        this.consumerName = consumerName;
        this.eventId = eventId;
        this.status = status;
        this.processedAt = processedAt;
        this.lastError = lastError;
      }
    }
  }
}
