package com.ryan.persimmon.start.config.bean;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.ryan.persimmon.start.config.properties.WorkflowRetryProperties;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class ConfigurableWorkflowRetryPolicyTest {

  @Test
  void maxAttempts_usesGlobalDefault_whenWorkflowMissingOrBlank() {
    WorkflowRetryProperties props = new WorkflowRetryProperties();
    props.setDefaultMaxAttempts(10);
    ConfigurableWorkflowRetryPolicy policy = new ConfigurableWorkflowRetryPolicy(props);

    assertEquals(10, policy.maxAttempts(null, "s1"));
    assertEquals(10, policy.maxAttempts(" ", "s1"));
    assertEquals(10, policy.maxAttempts("missing", "s1"));
  }

  @Test
  void maxAttempts_precedence_stepOverridesWorkflowOverridesGlobal() {
    WorkflowRetryProperties props = new WorkflowRetryProperties();
    props.setDefaultMaxAttempts(10);

    WorkflowRetryProperties.Workflow wf = new WorkflowRetryProperties.Workflow();
    wf.setDefaultMaxAttempts(7);

    WorkflowRetryProperties.Step step = new WorkflowRetryProperties.Step();
    step.setMaxAttempts(3);
    wf.getSteps().put("s1", step);

    props.getWorkflows().put("demo", wf);

    ConfigurableWorkflowRetryPolicy policy = new ConfigurableWorkflowRetryPolicy(props);
    assertEquals(3, policy.maxAttempts("demo", "s1"));
    assertEquals(7, policy.maxAttempts("demo", "s2"));
    assertEquals(10, policy.maxAttempts("missing", "s1"));
  }

  @Test
  void nextBackoff_usesGlobalDefault_whenNoOverrides() {
    WorkflowRetryProperties props = new WorkflowRetryProperties();
    props.setBaseBackoffMs(1000);
    props.setMaxBackoffMs(10_000);

    ConfigurableWorkflowRetryPolicy policy = new ConfigurableWorkflowRetryPolicy(props);
    assertEquals(Duration.ofMillis(1000), policy.nextBackoff("demo", "s1", 1, null));
    assertEquals(Duration.ofMillis(2000), policy.nextBackoff("demo", "s1", 2, null));
    assertEquals(Duration.ofMillis(4000), policy.nextBackoff("demo", "s1", 3, null));
    assertEquals(Duration.ofMillis(8000), policy.nextBackoff("demo", "s1", 4, null));
    assertEquals(Duration.ofMillis(10_000), policy.nextBackoff("demo", "s1", 5, null));
  }

  @Test
  void nextBackoff_precedence_stepOverridesWorkflowOverridesGlobal() {
    WorkflowRetryProperties props = new WorkflowRetryProperties();
    props.setBaseBackoffMs(1000);
    props.setMaxBackoffMs(10_000);

    WorkflowRetryProperties.Workflow wf = new WorkflowRetryProperties.Workflow();
    wf.setBaseBackoffMs(2000L);
    wf.setMaxBackoffMs(20_000L);

    WorkflowRetryProperties.Step step = new WorkflowRetryProperties.Step();
    step.setBaseBackoffMs(3000L);
    step.setMaxBackoffMs(30_000L);
    wf.getSteps().put("s1", step);

    props.getWorkflows().put("demo", wf);

    ConfigurableWorkflowRetryPolicy policy = new ConfigurableWorkflowRetryPolicy(props);
    assertEquals(Duration.ofMillis(3000), policy.nextBackoff("demo", "s1", 1, null));
    assertEquals(Duration.ofMillis(6000), policy.nextBackoff("demo", "s1", 2, null));

    // workflow-level config applies when step override missing
    assertEquals(Duration.ofMillis(2000), policy.nextBackoff("demo", "s2", 1, null));
    assertEquals(Duration.ofMillis(4000), policy.nextBackoff("demo", "s2", 2, null));
  }

  @Test
  void nextBackoff_attemptNumber_lessThanOne_isTreatedAsOne() {
    WorkflowRetryProperties props = new WorkflowRetryProperties();
    props.setBaseBackoffMs(1000);
    props.setMaxBackoffMs(10_000);

    ConfigurableWorkflowRetryPolicy policy = new ConfigurableWorkflowRetryPolicy(props);
    assertEquals(Duration.ofMillis(1000), policy.nextBackoff("demo", "s1", 0, null));
    assertEquals(Duration.ofMillis(1000), policy.nextBackoff("demo", "s1", -1, null));
  }

  @Test
  void nextBackoff_nonPositiveConfiguredBackoff_isClampedToZero() {
    WorkflowRetryProperties props = new WorkflowRetryProperties();
    props.setBaseBackoffMs(-1);
    props.setMaxBackoffMs(-1);

    ConfigurableWorkflowRetryPolicy policy = new ConfigurableWorkflowRetryPolicy(props);
    assertEquals(Duration.ofMillis(0), policy.nextBackoff("demo", "s1", 1, null));
    assertEquals(Duration.ofMillis(0), policy.nextBackoff("demo", "s1", 100, null));
  }
}

