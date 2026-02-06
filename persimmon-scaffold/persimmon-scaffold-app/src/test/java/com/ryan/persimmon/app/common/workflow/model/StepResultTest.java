package com.ryan.persimmon.app.common.workflow.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.ryan.persimmon.domain.common.event.DomainEvent;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class StepResultTest {

  @Test
  void waiting_normalizesOutboundEventsToImmutableList() {
    StepResult.Waiting w0 = StepResult.waiting("evt.x", Duration.ofSeconds(1), null);
    assertEquals(0, w0.outboundEvents().size());

    List<DomainEvent> src = new ArrayList<>();
    src.add(new FakeEvent());
    StepResult.Waiting w1 = StepResult.waiting("evt.x", Duration.ofSeconds(1), src);

    src.clear();
    assertEquals(1, w1.outboundEvents().size());
    assertThrows(
        UnsupportedOperationException.class, () -> w1.outboundEvents().add(new FakeEvent()));
  }

  @Test
  void helpers_createExpectedTypes() {
    assertEquals(StepResult.Completed.class, StepResult.completed().getClass());
    assertEquals(StepResult.Retry.class, StepResult.retry("x").getClass());
    assertEquals(StepResult.Dead.class, StepResult.dead("x").getClass());
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
