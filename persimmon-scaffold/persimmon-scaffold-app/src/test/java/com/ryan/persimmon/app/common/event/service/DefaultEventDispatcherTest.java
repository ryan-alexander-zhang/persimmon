package com.ryan.persimmon.app.common.event.service;

import static org.junit.jupiter.api.Assertions.*;

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
  void dispatch_should_be_idempotent_by_eventId_and_consumer() throws Exception {
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
  void dispatch_should_throw_when_no_handler_registered() {
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

    assertThrows(IllegalStateException.class, () -> dispatcher.dispatch(event));
    assertFalse(inbox.isProcessed(eventId, "c1"));
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
  void ctor_should_ignore_blank_eventType_handlers() throws Exception {
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
    private final List<String> processed = new ArrayList<>();

    @Override
    public boolean isProcessed(UUID eventId, String consumerName) {
      return processed.contains(consumerName + ":" + eventId);
    }

    @Override
    public void markProcessed(ConsumedEvent event, String consumerName, Instant processedAt) {
      processed.add(consumerName + ":" + event.eventId());
    }
  }
}
