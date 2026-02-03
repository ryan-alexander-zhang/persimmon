package com.ryan.persimmon.app.common.outbox.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OutboxMessageTest {

  @Test
  void headers_defaultsToEmpty_and_isDefensivelyCopied() {
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb4");
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb5");
    Instant occurredAt = Instant.parse("2026-02-03T00:00:00Z");

    OutboxMessage m0 =
        new OutboxMessage(eventId, occurredAt, "Agg", aggregateId, "Evt", "{}", null, 0);
    assertEquals(Map.of(), m0.headers());
    assertThrows(UnsupportedOperationException.class, () -> m0.headers().put("k", "v"));

    Map<String, String> src = new HashMap<>();
    src.put("traceId", "t-1");
    OutboxMessage m1 =
        new OutboxMessage(eventId, occurredAt, "Agg", aggregateId, "Evt", "{}", src, 0);
    src.put("traceId", "mutated");
    assertEquals(Map.of("traceId", "t-1"), m1.headers());
  }
}
