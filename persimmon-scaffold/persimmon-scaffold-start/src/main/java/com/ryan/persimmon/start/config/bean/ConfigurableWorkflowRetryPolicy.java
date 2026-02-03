package com.ryan.persimmon.start.config.bean;

import com.ryan.persimmon.app.common.workflow.port.WorkflowRetryPolicy;
import com.ryan.persimmon.start.config.properties.WorkflowRetryProperties;
import java.time.Duration;
import java.util.Map;

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
    WorkflowRetryProperties.Workflow wf = workflows().get(workflowType);
    if (wf == null) {
      return props.getDefaultMaxAttempts();
    }
    WorkflowRetryProperties.Step step = stepsOf(wf).get(stepType);
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
    BackoffConfig config = resolveBackoffConfig(workflowType, stepType);
    long backoffMs = computeExponentialBackoffMs(config.baseMs(), config.maxMs(), attemptNumber);
    return Duration.ofMillis(backoffMs);
  }

  private BackoffConfig resolveBackoffConfig(String workflowType, String stepType) {
    long base = props.getBaseBackoffMs();
    long max = props.getMaxBackoffMs();

    WorkflowRetryProperties.Workflow wf = workflows().get(workflowType);
    if (wf == null) {
      return new BackoffConfig(base, max);
    }

    Long wfBase = wf.getBaseBackoffMs();
    if (wfBase != null) {
      base = wfBase;
    }
    Long wfMax = wf.getMaxBackoffMs();
    if (wfMax != null) {
      max = wfMax;
    }

    WorkflowRetryProperties.Step step = stepsOf(wf).get(stepType);
    if (step == null) {
      return new BackoffConfig(base, max);
    }
    Long stepBase = step.getBaseBackoffMs();
    if (stepBase != null) {
      base = stepBase;
    }
    Long stepMax = step.getMaxBackoffMs();
    if (stepMax != null) {
      max = stepMax;
    }
    return new BackoffConfig(base, max);
  }

  private static long computeExponentialBackoffMs(long baseMs, long maxMs, int attemptNumber) {
    long base = Math.max(0, baseMs);
    long max = Math.max(0, maxMs);
    if (max == 0) {
      return 0;
    }

    int n = Math.max(1, attemptNumber);
    long backoff = base;
    for (int i = 1; i < n; i++) {
      if (backoff > max / 2) {
        return max;
      }
      backoff *= 2;
    }
    return Math.min(backoff, max);
  }

  private Map<String, WorkflowRetryProperties.Workflow> workflows() {
    Map<String, WorkflowRetryProperties.Workflow> workflows = props.getWorkflows();
    return workflows == null ? Map.of() : workflows;
  }

  private static Map<String, WorkflowRetryProperties.Step> stepsOf(WorkflowRetryProperties.Workflow wf) {
    Map<String, WorkflowRetryProperties.Step> steps = wf.getSteps();
    return steps == null ? Map.of() : steps;
  }

  private record BackoffConfig(long baseMs, long maxMs) {}
}
