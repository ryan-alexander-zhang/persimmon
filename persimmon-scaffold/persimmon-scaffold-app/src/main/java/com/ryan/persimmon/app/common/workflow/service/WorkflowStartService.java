package com.ryan.persimmon.app.common.workflow.service;

import com.ryan.persimmon.app.common.id.UuidV7Generator;
import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.app.common.workflow.definition.WorkflowDefinition;
import com.ryan.persimmon.app.common.workflow.definition.WorkflowDefinitionRegistry;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore.WorkflowStepToInsert;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstance;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstanceStatus;
import com.ryan.persimmon.domain.common.workflow.WorkflowStepStatus;
import com.ryan.persimmon.app.common.workflow.port.WorkflowRetryPolicy;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class WorkflowStartService {
  private final WorkflowStore workflowStore;
  private final WorkflowDefinitionRegistry definitionRegistry;
  private final UuidV7Generator uuidV7Generator;
  private final WorkflowRetryPolicy retryPolicy;
  private final AppClock clock;

  public WorkflowStartService(
      WorkflowStore workflowStore,
      WorkflowDefinitionRegistry definitionRegistry,
      UuidV7Generator uuidV7Generator,
      WorkflowRetryPolicy retryPolicy,
      AppClock clock) {
    this.workflowStore = workflowStore;
    this.definitionRegistry = definitionRegistry;
    this.uuidV7Generator = uuidV7Generator;
    this.retryPolicy = retryPolicy;
    this.clock = clock;
  }

  /** Starts the latest version of the given workflow type. */
  public UUID start(String workflowType, String bizKey, String contextJson) {
    Instant now = clock.now();
    WorkflowDefinition definition = definitionRegistry.requireLatest(workflowType);
    UUID instanceId = uuidV7Generator.next();

    String firstStepType = definition.stepTypeAt(0);
    WorkflowInstance instance = new WorkflowInstance(instanceId, definition.workflowType(), definition.version());
    instance.markStarted(0, firstStepType, contextJson, now);

    workflowStore.insertInstance(
        instanceId,
        bizKey,
        definition.workflowType(),
        definition.version(),
        WorkflowInstanceStatus.RUNNING,
        contextJson,
        0,
        firstStepType,
        now,
        now);

    List<WorkflowStepToInsert> steps = new ArrayList<>(definition.size());
    for (int seq = 0; seq < definition.size(); seq++) {
      String stepType = definition.stepTypeAt(seq);
      WorkflowStepStatus status = seq == 0 ? WorkflowStepStatus.READY : WorkflowStepStatus.PENDING;
      Instant nextRunAt = seq == 0 ? now : null;
      int maxAttempts = retryPolicy.maxAttempts(definition.workflowType(), stepType);
      steps.add(
          new WorkflowStepToInsert(
              instanceId, seq, stepType, status, maxAttempts, nextRunAt, now));
    }
    workflowStore.insertSteps(steps);
    return instanceId;
  }
}
