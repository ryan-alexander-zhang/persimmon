package com.acme.persimmon.demo.tenantprovisioning.start.config.properties;

import java.util.HashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "persimmon.workflow.retry")
public class WorkflowRetryProperties {
  /** Global default max attempts (per step). */
  private int defaultMaxAttempts = 10;

  /** Global base backoff in milliseconds. */
  private long baseBackoffMs = 1000;

  /** Global max backoff in milliseconds. */
  private long maxBackoffMs = 300_000;

  /** Per-workflow overrides keyed by workflowType. */
  private Map<String, Workflow> workflows = new HashMap<>();

  @Getter
  @Setter
  public static class Workflow {
    private Integer defaultMaxAttempts;
    private Long baseBackoffMs;
    private Long maxBackoffMs;
    private Map<String, Step> steps = new HashMap<>();
  }

  @Getter
  @Setter
  public static class Step {
    private Integer maxAttempts;
    private Long baseBackoffMs;
    private Long maxBackoffMs;
  }
}
