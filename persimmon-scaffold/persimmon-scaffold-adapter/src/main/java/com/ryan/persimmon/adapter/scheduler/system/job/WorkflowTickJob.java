package com.ryan.persimmon.adapter.scheduler.system.job;

import com.ryan.persimmon.app.common.workflow.service.WorkflowRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnBean(WorkflowRunner.class)
@ConditionalOnProperty(
    name = "persimmon.workflow.runner.enabled",
    havingValue = "true",
    matchIfMissing = false)
public class WorkflowTickJob {
  private final WorkflowRunner workflowRunner;
  private final int batchSize;

  public WorkflowTickJob(
      WorkflowRunner workflowRunner,
      @Value("${persimmon.workflow.runner.batch-size:50}") int batchSize) {
    this.workflowRunner = workflowRunner;
    this.batchSize = batchSize;
  }

  @Scheduled(fixedDelayString = "${persimmon.workflow.runner.fixed-delay-ms:1000}")
  public void run() {
    workflowRunner.tick(batchSize);
  }
}
