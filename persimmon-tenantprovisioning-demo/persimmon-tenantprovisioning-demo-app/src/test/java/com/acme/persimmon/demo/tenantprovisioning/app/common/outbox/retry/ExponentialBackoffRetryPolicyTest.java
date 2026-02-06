package com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.retry;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class ExponentialBackoffRetryPolicyTest {

  @Test
  void nextBackoff_should_grow_exponentially_and_cap_at_max() {
    RetryPolicy policy =
        new ExponentialBackoffRetryPolicy(Duration.ofSeconds(2), Duration.ofSeconds(10));

    assertEquals(Duration.ofSeconds(2), policy.nextBackoff(1));
    assertEquals(Duration.ofSeconds(4), policy.nextBackoff(2));
    assertEquals(Duration.ofSeconds(8), policy.nextBackoff(3));
    assertEquals(Duration.ofSeconds(10), policy.nextBackoff(4));
    assertEquals(Duration.ofSeconds(10), policy.nextBackoff(100));
  }
}
