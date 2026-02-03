package com.ryan.persimmon.start.config.bean;

import com.ryan.persimmon.app.common.workflow.port.WorkflowRetryPolicy;
import com.ryan.persimmon.start.config.properties.WorkflowRetryProperties;
import java.time.Duration;

public final class ConfigurableWorkflowRetryPolicy implements WorkflowRetryPolicy {
  private final WorkflowRetryProperties props;

  public ConfigurableWorkflowRetryPolicy(WorkflowRetryProperties props) {
    if (props == null) {
      throw new IllegalArgumentException("props must not be null.");
    }
    this.props = props;
  }

  @Override
  public int maxAttempts(String workflowType, String stepType) {
    if (workflowType == null || workflowType.isBlank()) {
      return props.getDefaultMaxAttempts();
    }
    WorkflowRetryProperties.Workflow wf = props.getWorkflows().get(workflowType);
    if (wf == null) {
      return props.getDefaultMaxAttempts();
    }
    WorkflowRetryProperties.Step step = wf.getSteps().get(stepType);
    if (step != null && step.getMaxAttempts() != null) {
      return step.getMaxAttempts();
    }
    return wf.getDefaultMaxAttempts() != null
        ? wf.getDefaultMaxAttempts()
        : props.getDefaultMaxAttempts();
  }

  @Override
  public Duration nextBackoff(
      String workflowType, String stepType, int attemptNumber, String lastError) {
    long base = props.getBaseBackoffMs();
    long max = props.getMaxBackoffMs();

    WorkflowRetryProperties.Workflow wf = props.getWorkflows().get(workflowType);
    if (wf != null) {
      if (wf.getBaseBackoffMs() != null) {
        base = wf.getBaseBackoffMs();
      }
      if (wf.getMaxBackoffMs() != null) {
        max = wf.getMaxBackoffMs();
      }
      WorkflowRetryProperties.Step step = wf.getSteps().get(stepType);
      if (step != null) {
        if (step.getBaseBackoffMs() != null) {
          base = step.getBaseBackoffMs();
        }
        if (step.getMaxBackoffMs() != null) {
          max = step.getMaxBackoffMs();
        }
      }
    }

    int n = Math.max(1, attemptNumber);
    long backoff = base;
    for (int i = 1; i < n; i++) {
      if (backoff > max / 2) {
        backoff = max;
        break;
      }
      backoff *= 2;
    }
    if (backoff > max) {
      backoff = max;
    }
    return Duration.ofMillis(Math.max(0, backoff));
  }
}
