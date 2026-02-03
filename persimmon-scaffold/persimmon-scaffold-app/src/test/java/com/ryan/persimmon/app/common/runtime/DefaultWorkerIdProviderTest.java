package com.ryan.persimmon.app.common.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class DefaultWorkerIdProviderTest {

  @Test
  void create_includesAppHostPidAndSuffix() {
    WorkerIdProvider provider = DefaultWorkerIdProvider.create("Persimmon-App");
    String workerId = provider.workerId();
    assertNotNull(workerId);

    String[] parts = workerId.split(":");
    assertEquals(4, parts.length);
    assertEquals("persimmon-app", parts[0]);
    assertTrue(parts[1].length() > 0);
    assertTrue(Long.parseLong(parts[2]) > 0);
    assertEquals(8, parts[3].length());
  }

  @Test
  void of_requiresNonBlank_and_trims() {
    assertThrows(IllegalArgumentException.class, () -> DefaultWorkerIdProvider.of(null));
    assertThrows(IllegalArgumentException.class, () -> DefaultWorkerIdProvider.of(" "));
    assertEquals("abc", DefaultWorkerIdProvider.of(" abc ").workerId());
  }

  @Test
  void create_normalizesMissingAndInvalidChars() {
    WorkerIdProvider p0 = DefaultWorkerIdProvider.create(null);
    assertTrue(p0.workerId().startsWith("unknown:"));

    WorkerIdProvider p1 = DefaultWorkerIdProvider.create("My App*Name");
    assertTrue(p1.workerId().startsWith("my-app-name:"));
  }
}
