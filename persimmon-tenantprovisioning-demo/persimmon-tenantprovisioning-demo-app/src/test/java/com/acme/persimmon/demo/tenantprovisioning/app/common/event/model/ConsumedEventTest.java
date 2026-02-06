package com.acme.persimmon.demo.tenantprovisioning.app.common.event.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ConsumedEventTest {

  @Test
  void headers_defaultsToEmpty_and_isDefensivelyCopied() {
    UUID eventId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb0");
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb1");
    Instant occurredAt = Instant.parse("2026-02-03T00:00:00Z");

    ConsumedEvent e0 = new ConsumedEvent(eventId, "t", occurredAt, "Agg", aggregateId, "{}", null);
    assertEquals(Map.of(), e0.headers());
    assertThrows(UnsupportedOperationException.class, () -> e0.headers().put("k", "v"));

    Map<String, String> src = new HashMap<>();
    src.put("traceId", "t-1");
    ConsumedEvent e1 = new ConsumedEvent(eventId, "t", occurredAt, "Agg", aggregateId, "{}", src);
    src.put("traceId", "mutated");
    assertEquals(Map.of("traceId", "t-1"), e1.headers());
  }
}
