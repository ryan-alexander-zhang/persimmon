package com.ryan.persimmon.app.common.outbox.port;

import com.ryan.persimmon.app.common.outbox.model.OutboxMessage;

/** Publishes an outbox message to an external transport (MQ/HTTP/etc.). */
public interface OutboxTransport {
  void publish(OutboxMessage message) throws Exception;
}
