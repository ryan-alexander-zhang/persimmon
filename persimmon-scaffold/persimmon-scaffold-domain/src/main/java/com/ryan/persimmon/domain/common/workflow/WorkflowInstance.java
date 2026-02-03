package com.ryan.persimmon.domain.common.workflow;

import com.ryan.persimmon.domain.common.event.DomainEvent;
import com.ryan.persimmon.domain.common.event.HasDomainEvents;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class WorkflowInstance implements HasDomainEvents {
  private final UUID instanceId;
  private final String workflowType;
  private final int workflowVersion;

  private WorkflowInstanceStatus status;
  private int currentStepSeq;
  private String currentStepType;

  private String contextJson;

  private Instant startedAt;
  private Instant completedAt;
  private Instant failedAt;

  private final List<DomainEvent> domainEvents = new ArrayList<>();

  public WorkflowInstance(UUID instanceId, String workflowType, int workflowVersion) {
    this.instanceId = instanceId;
    this.workflowType = workflowType;
    this.workflowVersion = workflowVersion;
  }

  public UUID getInstanceId() {
    return instanceId;
  }

  public String getWorkflowType() {
    return workflowType;
  }

  public int getWorkflowVersion() {
    return workflowVersion;
  }

  public WorkflowInstanceStatus getStatus() {
    return status;
  }

  public int getCurrentStepSeq() {
    return currentStepSeq;
  }

  public String getCurrentStepType() {
    return currentStepType;
  }

  public String getContextJson() {
    return contextJson;
  }

  public Instant getStartedAt() {
    return startedAt;
  }

  public Instant getCompletedAt() {
    return completedAt;
  }

  public Instant getFailedAt() {
    return failedAt;
  }

  public void restore(
      WorkflowInstanceStatus status,
      int currentStepSeq,
      String currentStepType,
      String contextJson,
      Instant startedAt,
      Instant completedAt,
      Instant failedAt) {
    this.status = status;
    this.currentStepSeq = currentStepSeq;
    this.currentStepType = currentStepType;
    this.contextJson = contextJson;
    this.startedAt = startedAt;
    this.completedAt = completedAt;
    this.failedAt = failedAt;
  }

  public void recordEvent(DomainEvent event) {
    DomainEvent.validate(event);
    domainEvents.add(event);
  }

  public void markStarted(int firstStepSeq, String firstStepType, String contextJson, Instant now) {
    this.status = WorkflowInstanceStatus.RUNNING;
    this.currentStepSeq = firstStepSeq;
    this.currentStepType = firstStepType;
    this.contextJson = contextJson;
    this.startedAt = now;
    this.completedAt = null;
    this.failedAt = null;
  }

  public void markCompleted(Instant now) {
    this.status = WorkflowInstanceStatus.COMPLETED;
    this.completedAt = now;
    this.failedAt = null;
  }

  public void markFailed(Instant now) {
    this.status = WorkflowInstanceStatus.FAILED;
    this.failedAt = now;
    this.completedAt = null;
  }

  public void advanceTo(int nextStepSeq, String nextStepType) {
    this.currentStepSeq = nextStepSeq;
    this.currentStepType = nextStepType;
  }

  @Override
  public List<DomainEvent> pullDomainEvents() {
    if (domainEvents.isEmpty()) {
      return List.of();
    }
    List<DomainEvent> snapshot = List.copyOf(domainEvents);
    domainEvents.clear();
    return snapshot;
  }

  @Override
  public List<DomainEvent> peekDomainEvents() {
    return Collections.unmodifiableList(domainEvents);
  }
}
