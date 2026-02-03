package com.ryan.persimmon.app.common.workflow.service;

import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import java.time.Instant;
import java.util.UUID;

public class WorkflowSignalService {
  private final WorkflowStore workflowStore;
  private final AppClock clock;

  public WorkflowSignalService(WorkflowStore workflowStore, AppClock clock) {
    this.workflowStore = workflowStore;
    this.clock = clock;
  }

  public boolean signal(UUID instanceId, String waitingEventType) {
    Instant now = clock.now();
    return workflowStore.wakeUpWaitingStep(instanceId, waitingEventType, now);
  }
}
