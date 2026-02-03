package com.ryan.persimmon.app.common.workflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ryan.persimmon.app.common.outbox.port.OutboxEventTypeResolver;
import com.ryan.persimmon.app.common.outbox.port.OutboxPayloadSerializer;
import com.ryan.persimmon.app.common.outbox.port.OutboxStore;
import com.ryan.persimmon.app.common.outbox.service.DomainEventOutboxService;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.app.common.workflow.definition.WorkflowDefinition;
import com.ryan.persimmon.app.common.workflow.definition.WorkflowDefinitionProvider;
import com.ryan.persimmon.app.common.workflow.model.StepResult;
import com.ryan.persimmon.app.common.workflow.model.WorkflowTask;
import com.ryan.persimmon.app.common.workflow.model.WorkflowTaskType;
import com.ryan.persimmon.app.common.workflow.port.WorkflowRetryPolicy;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStepHandler;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore.WorkflowStepToInsert;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstance;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstanceStatus;
import com.ryan.persimmon.domain.common.workflow.WorkflowStepStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WorkflowRunnerTest {

  @Test
  void completed_advancesToNextStep() {
    Instant now = Instant.parse("2026-02-03T00:00:00Z");
    FakeWorkflowStore store = new FakeWorkflowStore(now);

    UUID instanceId = UUID.randomUUID();
    store.seedInstance(instanceId, "demo", 1, "s1", now, 3);

    WorkflowStepHandler s1 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s1";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            return new StepResult.Completed();
          }
        };

    WorkflowStepHandler s2 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s2";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            return new StepResult.Completed();
          }
        };

    WorkflowRunner runner = createRunner(store, now, List.of(s1, s2), demoDefinition());
    runner.tick(10);

    FakeWorkflowStore.InstanceRow row = store.instances.get(instanceId);
    assertEquals(1, row.currentStepSeq);
    assertEquals("s2", row.currentStepType);
    assertEquals("DONE", row.steps.get(0).status);
    assertEquals("READY", row.steps.get(1).status);
  }

  @Test
  void waiting_setsWaitingStatusAndCanBeWokenUp() {
    Instant now = Instant.parse("2026-02-03T00:00:00Z");
    FakeWorkflowStore store = new FakeWorkflowStore(now);

    UUID instanceId = UUID.randomUUID();
    store.seedInstance(instanceId, "demo", 1, "s1", now, 3);

    java.util.concurrent.atomic.AtomicBoolean firstCall = new java.util.concurrent.atomic.AtomicBoolean(true);

    WorkflowStepHandler s1 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s1";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            if (firstCall.getAndSet(false)) {
              return new StepResult.Waiting("evt.x", Duration.ofSeconds(10), List.of());
            }
            return new StepResult.Completed();
          }
        };

    WorkflowStepHandler s2 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s2";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            return new StepResult.Completed();
          }
        };

    WorkflowRunner runner = createRunner(store, now, List.of(s1, s2), demoDefinition());
    runner.tick(10);

    FakeWorkflowStore.StepRow s1row = store.instances.get(instanceId).steps.get(0);
    assertEquals("WAITING", s1row.status);
    assertEquals("evt.x", s1row.waitingEventType);
    assertTrue(s1row.deadlineAt.isAfter(now));

    // external event wakes up the waiting step
    assertTrue(store.wakeUpWaitingStep(instanceId, "evt.x", now));
    runner.tick(10);
    assertEquals(1, store.instances.get(instanceId).currentStepSeq);
  }

  @Test
  void waitingTimeout_claimsAndInvokesHandlerWithWaitingTimeout() {
    Instant now = Instant.parse("2026-02-03T00:00:00Z");
    FakeWorkflowStore store = new FakeWorkflowStore(now);

    UUID instanceId = UUID.randomUUID();
    store.seedInstance(instanceId, "demo", 1, "s1", now, 3);
    store.instances.get(instanceId).steps.get(0).status = "WAITING";
    store.instances.get(instanceId).steps.get(0).waitingEventType = "evt.x";
    store.instances.get(instanceId).steps.get(0).deadlineAt = now.minusSeconds(1);

    WorkflowStepHandler s1 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s1";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            assertEquals(WorkflowTaskType.WAITING_TIMEOUT, taskType);
            return new StepResult.Dead("timeout");
          }
        };

    WorkflowStepHandler s2 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s2";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            return new StepResult.Completed();
          }
        };

    WorkflowRunner runner = createRunner(store, now, List.of(s1, s2), demoDefinition());
    runner.tick(10);

    FakeWorkflowStore.InstanceRow row = store.instances.get(instanceId);
    assertEquals(WorkflowInstanceStatus.FAILED.name(), row.status);
    assertEquals("DEAD", row.steps.get(0).status);
  }

  @Test
  void retry_exhausted_marksDeadAndFailsInstance() {
    Instant now = Instant.parse("2026-02-03T00:00:00Z");
    FakeWorkflowStore store = new FakeWorkflowStore(now);

    UUID instanceId = UUID.randomUUID();
    store.seedInstance(instanceId, "demo", 1, "s1", now, 1);

    WorkflowStepHandler s1 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s1";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            return new StepResult.Retry("boom");
          }
        };

    WorkflowStepHandler s2 =
        new WorkflowStepHandler() {
          @Override
          public String workflowType() {
            return "demo";
          }

          @Override
          public String stepType() {
            return "s2";
          }

          @Override
          public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
            return new StepResult.Completed();
          }
        };

    WorkflowRunner runner = createRunner(store, now, List.of(s1, s2), demoDefinition());
    runner.tick(10);

    FakeWorkflowStore.InstanceRow row = store.instances.get(instanceId);
    assertEquals("DEAD", row.steps.get(0).status);
    assertEquals(WorkflowInstanceStatus.FAILED.name(), row.status);
  }

  private static WorkflowDefinitionProvider demoDefinition() {
    return () -> new WorkflowDefinition("demo", 1, List.of("s1", "s2"));
  }

  private static WorkflowRunner createRunner(
      FakeWorkflowStore store,
      Instant now,
      List<WorkflowStepHandler> handlers,
      WorkflowDefinitionProvider provider) {
    OutboxStore noopOutbox =
        new OutboxStore() {
          @Override
          public void append(List<com.ryan.persimmon.app.common.outbox.model.OutboxMessage> messages) {}

          @Override
          public List<com.ryan.persimmon.app.common.outbox.model.OutboxMessage> claimNextBatch(
              int batchSize, Instant now) {
            return List.of();
          }

          @Override
          public void markSent(UUID eventId, Instant sentAt) {}

          @Override
          public void markFailed(UUID eventId, Instant now, Instant nextRetryAt, String lastError) {}

          @Override
          public void markDead(UUID eventId, Instant now, String lastError) {}
        };
    OutboxPayloadSerializer serializer = event -> "{}";
    OutboxEventTypeResolver typeResolver = event -> event.getClass().getName();
    DomainEventOutboxService outboxService = new DomainEventOutboxService(noopOutbox, serializer, typeResolver);

    WorkflowStepHandlerRegistry handlerRegistry = new WorkflowStepHandlerRegistry(handlers);
    AppClock clock = () -> now;
    WorkflowRetryPolicy retryPolicy =
        new WorkflowRetryPolicy() {
          @Override
          public int maxAttempts(String workflowType, String stepType) {
            return 3;
          }

          @Override
          public Duration nextBackoff(String workflowType, String stepType, int attemptNumber, String lastError) {
            return Duration.ofSeconds(1);
          }
        };
    WorkflowTaskProcessor processor =
        new WorkflowTaskProcessorImpl(store, handlerRegistry, outboxService, retryPolicy, clock);
    return new WorkflowRunner(store, processor, clock);
  }

  private static final class FakeWorkflowStore implements WorkflowStore {
    private final Instant now;
    private final Map<UUID, InstanceRow> instances = new HashMap<>();

    private FakeWorkflowStore(Instant now) {
      this.now = now;
    }

    void seedInstance(
        UUID instanceId,
        String workflowType,
        int workflowVersion,
        String firstStepType,
        Instant startedAt,
        int maxAttempts) {
      InstanceRow row = new InstanceRow();
      row.instanceId = instanceId;
      row.workflowType = workflowType;
      row.workflowVersion = workflowVersion;
      row.status = WorkflowInstanceStatus.RUNNING.name();
      row.contextJson = "{}";
      row.currentStepSeq = 0;
      row.currentStepType = firstStepType;
      row.startedAt = startedAt;
      row.steps.put(0, StepRow.with(firstStepType, "READY", maxAttempts, now));
      row.steps.put(1, StepRow.with("s2", "PENDING", maxAttempts, null));
      instances.put(instanceId, row);
    }

    @Override
    public void releaseExpiredLeases(Instant now) {}

    @Override
    public List<WorkflowTask> claimNextReadySteps(int batchSize, Instant now) {
      List<WorkflowTask> list = new ArrayList<>();
      for (InstanceRow row : instances.values()) {
        if (!WorkflowInstanceStatus.RUNNING.name().equals(row.status)) {
          continue;
        }
        StepRow step = row.steps.get(row.currentStepSeq);
        if (step != null
            && "READY".equals(step.status)
            && step.nextRunAt != null
            && !step.nextRunAt.isAfter(now)) {
          list.add(
              new WorkflowTask(
                  WorkflowTaskType.READY_STEP,
                  row.instanceId,
                  row.currentStepSeq,
                  step.stepType,
                  step.attempts,
                  step.maxAttempts));
        }
      }
      return list;
    }

    @Override
    public List<WorkflowTask> claimNextTimedOutWaitingSteps(int batchSize, Instant now) {
      List<WorkflowTask> list = new ArrayList<>();
      for (InstanceRow row : instances.values()) {
        if (!WorkflowInstanceStatus.RUNNING.name().equals(row.status)) {
          continue;
        }
        StepRow step = row.steps.get(row.currentStepSeq);
        if (step != null
            && "WAITING".equals(step.status)
            && step.deadlineAt != null
            && !step.deadlineAt.isAfter(now)) {
          list.add(
              new WorkflowTask(
                  WorkflowTaskType.WAITING_TIMEOUT,
                  row.instanceId,
                  row.currentStepSeq,
                  step.stepType,
                  step.attempts,
                  step.maxAttempts));
        }
      }
      return list;
    }

    @Override
    public WorkflowInstance loadInstanceForUpdate(UUID instanceId) {
      InstanceRow row = instances.get(instanceId);
      WorkflowInstance instance = new WorkflowInstance(row.instanceId, row.workflowType, row.workflowVersion);
      instance.restore(
          WorkflowInstanceStatus.valueOf(row.status),
          row.currentStepSeq,
          row.currentStepType,
          row.contextJson,
          row.startedAt,
          row.completedAt,
          row.failedAt);
      return instance;
    }

    @Override
    public void insertInstance(
        UUID instanceId,
        String bizKey,
        String workflowType,
        int workflowVersion,
        String status,
        String contextJson,
        int currentStepSeq,
        String currentStepType,
        Instant startedAt,
        Instant now) {
      throw new UnsupportedOperationException();
    }

    @Override
    public void markStepDone(UUID instanceId, int stepSeq, Instant now) {
      StepRow step = instances.get(instanceId).steps.get(stepSeq);
      step.status = "DONE";
    }

    @Override
    public boolean activatePendingStep(UUID instanceId, int stepSeq, Instant now) {
      StepRow step = instances.get(instanceId).steps.get(stepSeq);
      if (step == null) {
        return false;
      }
      if (!"PENDING".equals(step.status)) {
        return false;
      }
      step.status = "READY";
      step.nextRunAt = now;
      return true;
    }

    @Override
    public boolean stepExists(UUID instanceId, int stepSeq) {
      return instances.get(instanceId).steps.containsKey(stepSeq);
    }

    @Override
    public String getStepType(UUID instanceId, int stepSeq) {
      StepRow row = instances.get(instanceId).steps.get(stepSeq);
      return row == null ? null : row.stepType;
    }

    @Override
    public void markStepWaiting(UUID instanceId, int stepSeq, String waitingEventType, Instant deadlineAt, Instant now) {
      StepRow step = instances.get(instanceId).steps.get(stepSeq);
      step.status = "WAITING";
      step.waitingEventType = waitingEventType;
      step.deadlineAt = deadlineAt;
      step.nextRunAt = null;
    }

    @Override
    public void markStepRetry(UUID instanceId, int stepSeq, Instant nextRunAt, String lastError, Instant now) {
      StepRow step = instances.get(instanceId).steps.get(stepSeq);
      if (step.attempts + 1 >= step.maxAttempts) {
        throw new IllegalStateException("exhausted");
      }
      step.attempts += 1;
      step.status = "READY";
      step.nextRunAt = nextRunAt;
      step.lastError = lastError;
    }

    @Override
    public void markStepDead(UUID instanceId, int stepSeq, String lastError, Instant now) {
      StepRow step = instances.get(instanceId).steps.get(stepSeq);
      step.status = "DEAD";
      step.lastError = lastError;
    }

    @Override
    public void updateInstance(
        UUID instanceId,
        String status,
        int currentStepSeq,
        String currentStepType,
        String contextJson,
        Instant completedAt,
        Instant failedAt,
        Instant now) {
      InstanceRow row = instances.get(instanceId);
      row.status = status;
      row.currentStepSeq = currentStepSeq;
      row.currentStepType = currentStepType;
      row.contextJson = contextJson;
      row.completedAt = completedAt;
      row.failedAt = failedAt;
    }

    @Override
    public boolean wakeUpWaitingStep(UUID instanceId, String waitingEventType, Instant now) {
      InstanceRow row = instances.get(instanceId);
      StepRow step = row.steps.get(row.currentStepSeq);
      if (!"WAITING".equals(step.status)) {
        return false;
      }
      if (!waitingEventType.equals(step.waitingEventType)) {
        return false;
      }
      step.status = "READY";
      step.waitingEventType = null;
      step.deadlineAt = null;
      step.nextRunAt = now;
      return true;
    }

    private static final class InstanceRow {
      private UUID instanceId;
      private String workflowType;
      private int workflowVersion;
      private String status;
      private int currentStepSeq;
      private String currentStepType;
      private String contextJson;
      private Instant startedAt;
      private Instant completedAt;
      private Instant failedAt;
      private final Map<Integer, StepRow> steps = new HashMap<>();
    }

    private static final class StepRow {
      private String stepType;
      private String status;
      private int attempts;
      private int maxAttempts;
      private Instant nextRunAt;
      private String waitingEventType;
      private Instant deadlineAt;
      private String lastError;

      private static StepRow with(String stepType, String status, int maxAttempts, Instant nextRunAt) {
        StepRow row = new StepRow();
        row.stepType = stepType;
        row.status = status;
        row.attempts = 0;
        row.maxAttempts = maxAttempts;
        row.nextRunAt = nextRunAt;
        return row;
      }
    }

    @Override
    public void insertStep(
        UUID instanceId,
        int stepSeq,
        String stepType,
        WorkflowStepStatus status,
        int maxAttempts,
        Instant nextRunAt,
        Instant now) {
      instances.get(instanceId).steps.put(stepSeq, StepRow.with(stepType, status.name(), maxAttempts, nextRunAt));
    }

    @Override
    public void insertSteps(List<WorkflowStepToInsert> steps) {
      for (WorkflowStepToInsert s : steps) {
        insertStep(s.instanceId(), s.stepSeq(), s.stepType(), s.status(), s.maxAttempts(), s.nextRunAt(), s.now());
      }
    }
  }
}
