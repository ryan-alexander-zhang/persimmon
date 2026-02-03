package com.ryan.persimmon.app.common.workflow.model;

import com.ryan.persimmon.domain.common.event.DomainEvent;
import java.time.Duration;
import java.util.List;

/**
 * Result of executing a workflow step.
 *
 * <p>This engine is strictly linear (responsibility chain). Next step is determined by the
 * workflow definition order, not by step handlers.
 */
public sealed interface StepResult permits StepResult.Completed, StepResult.Waiting, StepResult.Retry, StepResult.Dead {

  /** Step completed successfully, advance to the next step in the definition (or finish). */
  record Completed() implements StepResult {}

  /**
   * Step issued an outbound request and is waiting for an external event.
   *
   * <p>Handlers may emit outbound domain events which are persisted through outbox in the same
   * transaction.
   */
  record Waiting(String waitingEventType, Duration timeout, List<DomainEvent> outboundEvents)
      implements StepResult {
    public Waiting {
      outboundEvents = outboundEvents == null ? List.of() : List.copyOf(outboundEvents);
    }
  }

  /** Indicates the step should be retried according to the configured workflow retry policy. */
  record Retry(String lastError) implements StepResult {}

  record Dead(String lastError) implements StepResult {}
}
