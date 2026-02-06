package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.event.DomainEvent;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class StepResultTest {

  @Test
  void waiting_normalizesOutboundEventsToImmutableList() {
    StepResult.Waiting w0 = new StepResult.Waiting("evt.x", Duration.ofSeconds(1), null);
    assertEquals(0, w0.outboundEvents().size());

    List<DomainEvent> src = new ArrayList<>();
    src.add(new FakeEvent());
    StepResult.Waiting w1 = new StepResult.Waiting("evt.x", Duration.ofSeconds(1), src);

    src.clear();
    assertEquals(1, w1.outboundEvents().size());
    assertThrows(
        UnsupportedOperationException.class, () -> w1.outboundEvents().add(new FakeEvent()));
  }

  private static final class FakeEvent implements DomainEvent {
    @Override
    public UUID eventId() {
      return UUID.randomUUID();
    }

    @Override
    public Instant occurredAt() {
      return Instant.parse("2026-02-03T00:00:00Z");
    }
  }
}
