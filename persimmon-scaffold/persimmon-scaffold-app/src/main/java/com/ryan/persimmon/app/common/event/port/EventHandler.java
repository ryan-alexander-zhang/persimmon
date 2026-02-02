package com.ryan.persimmon.app.common.event.port;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;

/** Application integration event handler. */
public interface EventHandler {
  /** Stable event type string this handler supports, e.g. {@code order.order-created.v1}. */
  String eventType();

  void handle(ConsumedEvent event) throws Exception;
}
