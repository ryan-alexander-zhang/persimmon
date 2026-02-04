package com.ryan.persimmon.app.common.event.service;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;
import com.ryan.persimmon.app.common.event.exception.EventHandlingException;
import com.ryan.persimmon.app.common.event.port.EventDispatcher;
import com.ryan.persimmon.app.common.event.port.EventHandler;
import com.ryan.persimmon.app.common.event.port.InboxStore;
import com.ryan.persimmon.app.common.time.AppClock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Default dispatcher that routes by {@code eventType} and enforces idempotency via inbox. */
public class DefaultEventDispatcher implements EventDispatcher {
  private final InboxStore inboxStore;
  private final AppClock clock;
  private final String consumerName;
  private final Map<String, EventHandler> handlersByType;

  public DefaultEventDispatcher(
      InboxStore inboxStore, AppClock clock, String consumerName, List<EventHandler> handlers) {
    this.inboxStore = inboxStore;
    this.clock = clock;
    this.consumerName = consumerName;
    this.handlersByType = indexByEventType(handlers);
  }

  private static Map<String, EventHandler> indexByEventType(List<EventHandler> handlers) {
    Map<String, EventHandler> map = new HashMap<>();
    for (EventHandler handler : handlers) {
      String type = handler.eventType();
      if (type == null || type.isBlank()) {
        continue;
      }
      EventHandler prev = map.put(type, handler);
      if (prev != null) {
        throw new IllegalStateException("Duplicate EventHandler for eventType=" + type);
      }
    }
    return Map.copyOf(map);
  }

  @Override
  public void dispatch(ConsumedEvent event) {
    Instant now = clock.now();
    if (!inboxStore.tryStart(event, consumerName, now)) {
      return;
    }

    EventHandler handler = handlersByType.get(event.eventType());
    if (handler == null) {
      inboxStore.markDead(
          event.eventId(),
          consumerName,
          now,
          "NO_HANDLER: " + (event.eventType() == null ? "" : event.eventType()));
      return;
    }

    try {
      handler.handle(event);
      inboxStore.markProcessed(event.eventId(), consumerName, now);
    } catch (RuntimeException e) {
      String lastError =
          e.getClass().getName() + ": " + (e.getMessage() == null ? "" : e.getMessage());
      if (e instanceof EventHandlingException ex) {
        if (ex.retryable()) {
          inboxStore.markFailed(event.eventId(), consumerName, now, lastError);
          throw ex;
        }
        inboxStore.markDead(event.eventId(), consumerName, now, lastError);
        return;
      }

      inboxStore.markFailed(event.eventId(), consumerName, now, lastError);
      throw EventHandlingException.retryable("EVENT_HANDLER_ERROR", "Handler execution failed.", e);
    }
  }
}
