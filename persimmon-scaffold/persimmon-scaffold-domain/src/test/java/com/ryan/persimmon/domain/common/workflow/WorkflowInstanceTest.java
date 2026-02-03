package com.ryan.persimmon.domain.common.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.ryan.persimmon.domain.common.event.DomainEvent;
import com.ryan.persimmon.domain.common.exception.DomainRuleViolationException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WorkflowInstanceTest {

  private static final UUID INSTANCE_ID =
      UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fc0");

  private static final UUID EVENT_ID_V7 =
      UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fc1");

  @Test
  void recordEvent_validatesAndStoresEvents() {
    WorkflowInstance instance = new WorkflowInstance(INSTANCE_ID, "demo", 1);

    assertThrows(DomainRuleViolationException.class, () -> instance.recordEvent(null));

    DomainEvent ok = new TestEvent(EVENT_ID_V7, Instant.parse("2026-02-03T00:00:00Z"));
    instance.recordEvent(ok);

    List<DomainEvent> peek = instance.peekDomainEvents();
    assertEquals(1, peek.size());
    assertEquals(EVENT_ID_V7, peek.getFirst().eventId());
    assertThrows(UnsupportedOperationException.class, () -> peek.add(ok));

    List<DomainEvent> pulled = instance.pullDomainEvents();
    assertEquals(1, pulled.size());
    assertEquals(0, instance.peekDomainEvents().size());
  }

  @Test
  void markStartedCompletedFailedAndAdvanceTo_updateState() {
    WorkflowInstance instance = new WorkflowInstance(INSTANCE_ID, "demo", 1);
    Instant t0 = Instant.parse("2026-02-03T00:00:00Z");

    instance.markStarted(0, "s1", "{\"k\":\"v\"}", t0);
    assertEquals(WorkflowInstanceStatus.RUNNING, instance.getStatus());
    assertEquals(0, instance.getCurrentStepSeq());
    assertEquals("s1", instance.getCurrentStepType());
    assertEquals("{\"k\":\"v\"}", instance.getContextJson());
    assertEquals(t0, instance.getStartedAt());

    instance.advanceTo(1, "s2");
    assertEquals(1, instance.getCurrentStepSeq());
    assertEquals("s2", instance.getCurrentStepType());

    Instant t1 = t0.plusSeconds(1);
    instance.markCompleted(t1);
    assertEquals(WorkflowInstanceStatus.COMPLETED, instance.getStatus());
    assertEquals(t1, instance.getCompletedAt());
    assertEquals(null, instance.getFailedAt());

    Instant t2 = t1.plusSeconds(1);
    instance.markFailed(t2);
    assertEquals(WorkflowInstanceStatus.FAILED, instance.getStatus());
    assertEquals(t2, instance.getFailedAt());
    assertEquals(null, instance.getCompletedAt());
  }

  @Test
  void restore_loadsPersistedState() {
    WorkflowInstance instance = new WorkflowInstance(INSTANCE_ID, "demo", 1);
    Instant startedAt = Instant.parse("2026-02-03T00:00:00Z");
    Instant completedAt = startedAt.plusSeconds(10);
    instance.restore(
        WorkflowInstanceStatus.COMPLETED,
        1,
        "s2",
        "{\"x\":1}",
        startedAt,
        completedAt,
        null);

    assertEquals(WorkflowInstanceStatus.COMPLETED, instance.getStatus());
    assertEquals(1, instance.getCurrentStepSeq());
    assertEquals("s2", instance.getCurrentStepType());
    assertEquals("{\"x\":1}", instance.getContextJson());
    assertEquals(startedAt, instance.getStartedAt());
    assertEquals(completedAt, instance.getCompletedAt());
    assertNotNull(instance.getWorkflowType());
  }

  private record TestEvent(UUID eventId, Instant occurredAt) implements DomainEvent {
    private TestEvent {
      DomainEvent.validate(eventId, occurredAt);
    }
  }
}

