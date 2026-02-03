package com.ryan.persimmon.app.common.workflow.service;

import com.ryan.persimmon.app.common.time.AppClock;
import com.ryan.persimmon.app.common.workflow.model.WorkflowTask;
import com.ryan.persimmon.app.common.workflow.port.WorkflowStore;
import java.time.Instant;
import java.util.List;

public class WorkflowRunner {
  private final WorkflowStore workflowStore;
  private final WorkflowTaskProcessor taskProcessor;
  private final AppClock clock;

  public WorkflowRunner(WorkflowStore workflowStore, WorkflowTaskProcessor taskProcessor, AppClock clock) {
    this.workflowStore = workflowStore;
    this.taskProcessor = taskProcessor;
    this.clock = clock;
  }

  public void tick(int batchSize) {
    Instant now = clock.now();
    workflowStore.releaseExpiredLeases(now);

    List<WorkflowTask> ready = workflowStore.claimNextReadySteps(batchSize, now);
    for (WorkflowTask task : ready) {
      taskProcessor.process(task);
    }

    List<WorkflowTask> timedOut = workflowStore.claimNextTimedOutWaitingSteps(batchSize, now);
    for (WorkflowTask task : timedOut) {
      taskProcessor.process(task);
    }
  }
}

