package com.ryan.persimmon.app.common.outbox.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class DomainEventContextTest {

  @Test
  void headers_defaultsToEmpty_and_isDefensivelyCopied() {
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb2");

    DomainEventContext c0 = new DomainEventContext("Agg", aggregateId, null);
    assertEquals(Map.of(), c0.headers());
    assertThrows(UnsupportedOperationException.class, () -> c0.headers().put("k", "v"));

    Map<String, String> src = new HashMap<>();
    src.put("traceId", "t-1");
    DomainEventContext c1 = new DomainEventContext("Agg", aggregateId, src);
    src.put("traceId", "mutated");
    assertEquals(Map.of("traceId", "t-1"), c1.headers());
  }

  @Test
  void of_buildsMinimalContext() {
    UUID aggregateId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb3");
    DomainEventContext ctx = DomainEventContext.of("Agg", aggregateId);
    assertEquals("Agg", ctx.aggregateType());
    assertEquals(aggregateId, ctx.aggregateId());
    assertEquals(Map.of(), ctx.headers());
  }
}
