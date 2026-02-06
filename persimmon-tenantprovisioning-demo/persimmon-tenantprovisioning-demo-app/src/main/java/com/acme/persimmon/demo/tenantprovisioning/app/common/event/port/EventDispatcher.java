package com.acme.persimmon.demo.tenantprovisioning.app.common.event.port;

import com.acme.persimmon.demo.tenantprovisioning.app.common.event.model.ConsumedEvent;

/** Application entry point for consuming integration events. */
public interface EventDispatcher {
  void dispatch(ConsumedEvent event);
}
