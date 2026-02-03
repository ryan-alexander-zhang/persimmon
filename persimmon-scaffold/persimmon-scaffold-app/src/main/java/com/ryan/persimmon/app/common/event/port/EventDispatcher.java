package com.ryan.persimmon.app.common.event.port;

import com.ryan.persimmon.app.common.event.model.ConsumedEvent;

/** Application entry point for consuming integration events. */
public interface EventDispatcher {
  void dispatch(ConsumedEvent event);
}
