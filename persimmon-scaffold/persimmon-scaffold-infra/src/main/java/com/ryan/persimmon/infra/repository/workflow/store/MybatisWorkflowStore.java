package com.ryan.persimmon.infra.repository.workflow.store;

import com.ryan.persimmon.app.common.workflow.model.WorkflowTask;
import com.ryan.persimmon.app.common.workflow.model.WorkflowTaskType;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore.WorkflowStepToInsert;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstance;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstanceStatus;
import com.ryan.persimmon.domain.common.workflow.WorkflowStepStatus;
import com.ryan.persimmon.infra.repository.workflow.mapper.WorkflowInstanceMapper;
import com.ryan.persimmon.infra.repository.workflow.mapper.WorkflowStepMapper;
import com.ryan.persimmon.infra.repository.workflow.po.WorkflowInstancePO;
import com.ryan.persimmon.infra.repository.workflow.po.WorkflowStepPO;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

public class MybatisWorkflowStore implements WorkflowStore {
  private final WorkflowInstanceMapper instanceMapper;
  private final WorkflowStepMapper stepMapper;
  private final String workerId;
  private final Duration lease;

  public MybatisWorkflowStore(
      WorkflowInstanceMapper instanceMapper,
      WorkflowStepMapper stepMapper,
      String workerId,
      Duration lease) {
    this.instanceMapper = instanceMapper;
    this.stepMapper = stepMapper;
    this.workerId = workerId;
    this.lease = lease;
  }

  @Override
  public void releaseExpiredLeases(Instant now) {
    stepMapper.releaseExpiredLocks(now);
  }

  @Override
  @Transactional
  public List<WorkflowTask> claimNextReadySteps(int batchSize, Instant now) {
    List<WorkflowStepPO> locked = stepMapper.lockNextReadyBatch(now, batchSize);
    if (locked.isEmpty()) {
      return List.of();
    }
    Instant lockedUntil = now.plus(lease);
    List<WorkflowTask> tasks = new ArrayList<>(locked.size());
    for (WorkflowStepPO po : locked) {
      int updated =
          stepMapper.markRunning(po.getInstanceId(), po.getStepSeq(), workerId, lockedUntil, now);
      if (updated == 1) {
        tasks.add(
            new WorkflowTask(
                WorkflowTaskType.READY_STEP,
                po.getInstanceId(),
                po.getStepSeq(),
                po.getStepType(),
                po.getAttempts() == null ? 0 : po.getAttempts(),
                po.getMaxAttempts() == null ? 0 : po.getMaxAttempts()));
      }
    }
    return tasks;
  }

  @Override
  @Transactional
  public List<WorkflowTask> claimNextTimedOutWaitingSteps(int batchSize, Instant now) {
    List<WorkflowStepPO> locked = stepMapper.lockNextTimedOutWaitingBatch(now, batchSize);
    if (locked.isEmpty()) {
      return List.of();
    }
    Instant lockedUntil = now.plus(lease);
    List<WorkflowTask> tasks = new ArrayList<>(locked.size());
    for (WorkflowStepPO po : locked) {
      int updated =
          stepMapper.markRunning(po.getInstanceId(), po.getStepSeq(), workerId, lockedUntil, now);
      if (updated == 1) {
        tasks.add(
            new WorkflowTask(
                WorkflowTaskType.WAITING_TIMEOUT,
                po.getInstanceId(),
                po.getStepSeq(),
                po.getStepType(),
                po.getAttempts() == null ? 0 : po.getAttempts(),
                po.getMaxAttempts() == null ? 0 : po.getMaxAttempts()));
      }
    }
    return tasks;
  }

  @Override
  public WorkflowInstance loadInstanceForUpdate(UUID instanceId) {
    WorkflowInstancePO po = instanceMapper.selectForUpdate(instanceId);
    if (po == null) {
      throw new IllegalStateException("Workflow instance not found: " + instanceId);
    }
    WorkflowInstance instance = new WorkflowInstance(po.getInstanceId(), po.getWorkflowType(), po.getWorkflowVersion());
    instance.restore(
        WorkflowInstanceStatus.valueOf(po.getStatus()),
        po.getCurrentStepSeq() == null ? 0 : po.getCurrentStepSeq(),
        po.getCurrentStepType(),
        po.getContextJson(),
        po.getStartedAt(),
        po.getCompletedAt(),
        po.getFailedAt());
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
    WorkflowInstancePO po = new WorkflowInstancePO();
    po.setInstanceId(instanceId);
    po.setBizKey(bizKey);
    po.setWorkflowType(workflowType);
    po.setWorkflowVersion(workflowVersion);
    po.setStatus(status);
    po.setCurrentStepSeq(currentStepSeq);
    po.setCurrentStepType(currentStepType);
    po.setContextJson(contextJson);
    po.setStartedAt(startedAt);
    po.setCompletedAt(null);
    po.setFailedAt(null);
    po.setCreatedAt(now);
    po.setUpdatedAt(now);
    instanceMapper.insert(po);
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
    WorkflowStepPO po = new WorkflowStepPO();
    po.setInstanceId(instanceId);
    po.setStepSeq(stepSeq);
    po.setStepType(stepType);
    po.setStatus(status.name());
    po.setAttempts(0);
    po.setMaxAttempts(maxAttempts);
    po.setNextRunAt(nextRunAt);
    po.setWaitingEventType(null);
    po.setDeadlineAt(null);
    po.setLockedBy(null);
    po.setLockedUntil(null);
    po.setLastError(null);
    po.setCreatedAt(now);
    po.setUpdatedAt(now);
    stepMapper.insertIfAbsent(po);
  }

  @Override
  public void insertSteps(List<WorkflowStepToInsert> steps) {
    if (steps == null || steps.isEmpty()) {
      return;
    }
    List<WorkflowStepPO> list = new java.util.ArrayList<>(steps.size());
    for (WorkflowStepToInsert it : steps) {
      WorkflowStepPO po = new WorkflowStepPO();
      po.setInstanceId(it.instanceId());
      po.setStepSeq(it.stepSeq());
      po.setStepType(it.stepType());
      po.setStatus(it.status().name());
      po.setAttempts(0);
      po.setMaxAttempts(it.maxAttempts());
      po.setNextRunAt(it.nextRunAt());
      po.setWaitingEventType(null);
      po.setDeadlineAt(null);
      po.setLockedBy(null);
      po.setLockedUntil(null);
      po.setLastError(null);
      po.setCreatedAt(it.now());
      po.setUpdatedAt(it.now());
      list.add(po);
    }
    stepMapper.insertBatchIfAbsent(list);
  }

  @Override
  public void markStepDone(UUID instanceId, int stepSeq, Instant now) {
    int updated = stepMapper.markDone(instanceId, stepSeq, workerId, now);
    if (updated != 1) {
      throw new IllegalStateException("Failed to mark workflow step DONE: " + instanceId + " seq=" + stepSeq);
    }
  }

  @Override
  public boolean activatePendingStep(UUID instanceId, int stepSeq, Instant now) {
    return stepMapper.activatePending(instanceId, stepSeq, now) == 1;
  }

  @Override
  public boolean stepExists(UUID instanceId, int stepSeq) {
    return stepMapper.countByInstanceAndSeq(instanceId, stepSeq) > 0;
  }

  @Override
  public String getStepType(UUID instanceId, int stepSeq) {
    return stepMapper.selectStepType(instanceId, stepSeq);
  }

  @Override
  public void markStepWaiting(
      UUID instanceId, int stepSeq, String waitingEventType, Instant deadlineAt, Instant now) {
    int updated = stepMapper.markWaiting(instanceId, stepSeq, waitingEventType, deadlineAt, workerId, now);
    if (updated != 1) {
      throw new IllegalStateException("Failed to mark workflow step WAITING: " + instanceId + " seq=" + stepSeq);
    }
  }

  @Override
  public void markStepRetry(
      UUID instanceId, int stepSeq, Instant nextRunAt, String lastError, Instant now) {
    int updated = stepMapper.markRetry(instanceId, stepSeq, nextRunAt, lastError, workerId, now);
    if (updated != 1) {
      throw new IllegalStateException("Failed to mark workflow step READY: " + instanceId + " seq=" + stepSeq);
    }
  }

  @Override
  public void markStepDead(UUID instanceId, int stepSeq, String lastError, Instant now) {
    int updated = stepMapper.markDead(instanceId, stepSeq, lastError, workerId, now);
    if (updated != 1) {
      throw new IllegalStateException("Failed to mark workflow step DEAD: " + instanceId + " seq=" + stepSeq);
    }
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
    WorkflowInstancePO po = new WorkflowInstancePO();
    po.setInstanceId(instanceId);
    po.setStatus(status);
    po.setCurrentStepSeq(currentStepSeq);
    po.setCurrentStepType(currentStepType);
    po.setContextJson(contextJson);
    po.setCompletedAt(completedAt);
    po.setFailedAt(failedAt);
    int updated = instanceMapper.update(po, now);
    if (updated != 1) {
      throw new IllegalStateException("Failed to update workflow instance: " + instanceId);
    }
  }

  @Override
  public boolean wakeUpWaitingStep(UUID instanceId, String waitingEventType, Instant now) {
    return stepMapper.wakeUpWaitingStep(instanceId, waitingEventType, now) > 0;
  }
}
