package com.acme.persimmon.demo.tenantprovisioning.app.common.time;

import java.time.Instant;

/** Application clock abstraction (test-friendly). */
public interface AppClock {
  Instant now();
}
