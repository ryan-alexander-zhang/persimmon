package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port;

import java.time.Duration;

public interface WorkflowRetryPolicy {

  int maxAttempts(String workflowType, String stepType);

  /**
   * Computes the backoff duration for the next retry attempt.
   *
   * @param attemptNumber next attempt number (1-based)
   */
  Duration nextBackoff(String workflowType, String stepType, int attemptNumber, String lastError);
}
