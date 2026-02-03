package com.ryan.persimmon.app.common.workflow.port;

import com.ryan.persimmon.app.common.workflow.model.WorkflowTask;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstance;
import com.ryan.persimmon.domain.common.workflow.WorkflowStepStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface WorkflowStore {
  void releaseExpiredLeases(Instant now);

  List<WorkflowTask> claimNextReadySteps(int batchSize, Instant now);

  List<WorkflowTask> claimNextTimedOutWaitingSteps(int batchSize, Instant now);

  WorkflowInstance loadInstanceForUpdate(UUID instanceId);

  void insertInstance(
      UUID instanceId,
      String bizKey,
      String workflowType,
      int workflowVersion,
      String status,
      String contextJson,
      int currentStepSeq,
      String currentStepType,
      Instant startedAt,
      Instant now);

  void insertStep(
      UUID instanceId,
      int stepSeq,
      String stepType,
      WorkflowStepStatus status,
      int maxAttempts,
      Instant nextRunAt,
      Instant now);

  void insertSteps(List<WorkflowStepToInsert> steps);

  void markStepDone(UUID instanceId, int stepSeq, Instant now);

  /**
   * Activates a PENDING step to READY (next_run_at=now).
   *
   * @return true if activated; false if no row was updated.
   */
  boolean activatePendingStep(UUID instanceId, int stepSeq, Instant now);

  boolean stepExists(UUID instanceId, int stepSeq);

  String getStepType(UUID instanceId, int stepSeq);

  void markStepWaiting(
      UUID instanceId,
      int stepSeq,
      String waitingEventType,
      Instant deadlineAt,
      Instant now);

  void markStepRetry(UUID instanceId, int stepSeq, Instant nextRunAt, String lastError, Instant now);

  void markStepDead(UUID instanceId, int stepSeq, String lastError, Instant now);

  void updateInstance(
      UUID instanceId,
      String status,
      int currentStepSeq,
      String currentStepType,
      String contextJson,
      Instant completedAt,
      Instant failedAt,
      Instant now);

  /**
   * Wakes up a waiting step when an external event arrives.
   *
   * <p>Returns true if the state was updated.
   */
  boolean wakeUpWaitingStep(UUID instanceId, String waitingEventType, Instant now);

  record WorkflowStepToInsert(
      UUID instanceId,
      int stepSeq,
      String stepType,
      WorkflowStepStatus status,
      int maxAttempts,
      Instant nextRunAt,
      Instant now) {}
}
