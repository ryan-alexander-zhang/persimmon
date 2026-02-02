package com.ryan.persimmon.app.common.time;

import java.time.Instant;

/** Application clock abstraction (test-friendly). */
public interface AppClock {
  Instant now();
}

