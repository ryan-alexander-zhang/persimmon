package com.ryan.persimmon.app.common.runtime;

import java.net.InetAddress;
import java.util.Locale;
import java.util.UUID;

public final class DefaultWorkerIdProvider implements WorkerIdProvider {
  private final String workerId;

  private DefaultWorkerIdProvider(String workerId) {
    this.workerId = workerId;
  }

  public static DefaultWorkerIdProvider create(String applicationName) {
    String app = normalize(applicationName);
    String host = normalize(detectHostname());
    long pid = ProcessHandle.current().pid();
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return new DefaultWorkerIdProvider(app + ":" + host + ":" + pid + ":" + suffix);
  }

  private static String normalize(String value) {
    if (value == null || value.isBlank()) {
      return "unknown";
    }
    String trimmed = value.trim().toLowerCase(Locale.ROOT);
    return trimmed.replaceAll("[^a-z0-9_.-]", "-");
  }

  private static String detectHostname() {
    String envHostname = System.getenv("HOSTNAME");
    if (envHostname != null && !envHostname.isBlank()) {
      return envHostname;
    }
    try {
      return InetAddress.getLocalHost().getHostName();
    } catch (Exception ignored) {
      return "unknown-host";
    }
  }

  public static DefaultWorkerIdProvider of(String workerId) {
    if (workerId == null || workerId.isBlank()) {
      throw new IllegalArgumentException("workerId must not be blank.");
    }
    return new DefaultWorkerIdProvider(workerId.trim());
  }

  @Override
  public String workerId() {
    return workerId;
  }
}

