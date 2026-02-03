package com.ryan.persimmon.app.common.workflow.service;

import com.ryan.persimmon.app.common.outbox.model.DomainEventContext;
import com.ryan.persimmon.app.common.outbox.service.DomainEventOutboxService;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.app.common.workflow.model.StepResult;
import com.ryan.persimmon.app.common.workflow.model.WorkflowTask;
import com.ryan.persimmon.app.common.workflow.port.WorkflowRetryPolicy;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStepHandler;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstance;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstanceStatus;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Strict linear workflow task processor.
 *
 * <p>Step handlers do not decide the next step. The next step is determined by the workflow
 * definition ordering.
 */
public class WorkflowTaskProcessorImpl implements WorkflowTaskProcessor {
  private static final String AGGREGATE_TYPE = "WORKFLOW_INSTANCE";

  private final WorkflowStore workflowStore;
  private final WorkflowStepHandlerRegistry handlerRegistry;
  private final DomainEventOutboxService outboxService;
  private final WorkflowRetryPolicy retryPolicy;
  private final AppClock clock;

  public WorkflowTaskProcessorImpl(
      WorkflowStore workflowStore,
      WorkflowStepHandlerRegistry handlerRegistry,
      DomainEventOutboxService outboxService,
      WorkflowRetryPolicy retryPolicy,
      AppClock clock) {
    this.workflowStore = workflowStore;
    this.handlerRegistry = handlerRegistry;
    this.outboxService = outboxService;
    this.retryPolicy = retryPolicy;
    this.clock = clock;
  }

  @Override
  public void process(WorkflowTask task) {
    Instant now = clock.now();
    WorkflowInstance instance = workflowStore.loadInstanceForUpdate(task.instanceId());
    if (instance.getStatus() != WorkflowInstanceStatus.RUNNING) {
      return;
    }

    WorkflowStepHandler handler = handlerRegistry.require(instance.getWorkflowType(), task.stepType());
    StepResult result = handler.execute(instance, task.type());
    applyResult(instance, task, result, now);
  }

  private void applyResult(WorkflowInstance instance, WorkflowTask task, StepResult result, Instant now) {
    int stepSeq = task.stepSeq();
    switch (result) {
      case StepResult.Completed ignored -> onCompleted(instance, stepSeq, now);
      case StepResult.Waiting waiting -> onWaiting(instance, stepSeq, waiting, now);
      case StepResult.Retry retry -> onRetry(instance, task, retry, now);
      case StepResult.Dead dead -> onDead(instance, stepSeq, dead, now);
    }
  }

  private void onCompleted(WorkflowInstance instance, int stepSeq, Instant now) {
    workflowStore.markStepDone(instance.getInstanceId(), stepSeq, now);

    int nextSeq = stepSeq + 1;
    if (!workflowStore.stepExists(instance.getInstanceId(), nextSeq)) {
      instance.markCompleted(now);
      persistAndOutbox(instance, now);
      return;
    }

    if (!workflowStore.activatePendingStep(instance.getInstanceId(), nextSeq, now)) {
      throw new IllegalStateException(
          "Next workflow step is not PENDING: instanceId=" + instance.getInstanceId() + ", stepSeq=" + nextSeq);
    }

    String nextStepType = workflowStore.getStepType(instance.getInstanceId(), nextSeq);
    if (nextStepType == null || nextStepType.isBlank()) {
      throw new IllegalStateException(
          "Next workflow stepType not found: instanceId=" + instance.getInstanceId() + ", stepSeq=" + nextSeq);
    }
    instance.advanceTo(nextSeq, nextStepType);
    persistAndOutbox(instance, now);
  }

  private void onWaiting(WorkflowInstance instance, int stepSeq, StepResult.Waiting waiting, Instant now) {
    waiting.outboundEvents().forEach(instance::recordEvent);
    Instant deadlineAt = now.plus(waiting.timeout());
    workflowStore.markStepWaiting(instance.getInstanceId(), stepSeq, waiting.waitingEventType(), deadlineAt, now);
    persistAndOutbox(instance, now);
  }

  private void onRetry(WorkflowInstance instance, WorkflowTask task, StepResult.Retry retry, Instant now) {
    int nextAttemptNumber = task.attempts() + 1;
    Instant nextRunAt =
        now.plus(
            retryPolicy.nextBackoff(
                instance.getWorkflowType(), task.stepType(), nextAttemptNumber, retry.lastError()));

    if (!tryMarkRetry(instance.getInstanceId(), task.stepSeq(), nextRunAt, retry.lastError(), now)) {
      workflowStore.markStepDead(instance.getInstanceId(), task.stepSeq(), retry.lastError(), now);
      instance.markFailed(now);
    }
    persistAndOutbox(instance, now);
  }

  private void onDead(WorkflowInstance instance, int stepSeq, StepResult.Dead dead, Instant now) {
    workflowStore.markStepDead(instance.getInstanceId(), stepSeq, dead.lastError(), now);
    instance.markFailed(now);
    persistAndOutbox(instance, now);
  }

  private void persistAndOutbox(WorkflowInstance instance, Instant now) {
    workflowStore.updateInstance(
        instance.getInstanceId(),
        instance.getStatus(),
        instance.getCurrentStepSeq(),
        instance.getCurrentStepType(),
        instance.getContextJson(),
        instance.getCompletedAt(),
        instance.getFailedAt(),
        now);
    outboxService.recordPulledDomainEvents(
        instance,
        new DomainEventContext(AGGREGATE_TYPE, instance.getInstanceId(), Map.of()));
  }

  private boolean tryMarkRetry(
      UUID instanceId, int stepSeq, Instant nextRunAt, String lastError, Instant now) {
    try {
      workflowStore.markStepRetry(instanceId, stepSeq, nextRunAt, lastError, now);
      return true;
    } catch (IllegalStateException e) {
      return false;
    }
  }
}
