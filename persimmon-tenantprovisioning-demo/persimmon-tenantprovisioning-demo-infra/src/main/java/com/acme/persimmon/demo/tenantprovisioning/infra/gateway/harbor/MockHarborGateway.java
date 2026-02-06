package com.acme.persimmon.demo.tenantprovisioning.infra.gateway.harbor;

import com.acme.persimmon.demo.tenantprovisioning.domain.biz.gateway.HarborGateway;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.UUID;

public final class MockHarborGateway implements HarborGateway {
  private final Map<String, Boolean> projects = new ConcurrentHashMap<>();
  private final Map<String, HarborRobotCredential> robots = new ConcurrentHashMap<>();

  @Override
  public void createProject(String projectName) {
    if (projectName == null || projectName.isBlank()) {
      throw new IllegalArgumentException("projectName must not be blank.");
    }
    projects.putIfAbsent(projectName, Boolean.TRUE);
  }

  @Override
  public HarborRobotCredential createRobot(String projectName, String robotName) {
    if (projectName == null || projectName.isBlank()) {
      throw new IllegalArgumentException("projectName must not be blank.");
    }
    if (robotName == null || robotName.isBlank()) {
      throw new IllegalArgumentException("robotName must not be blank.");
    }
    if (!projects.containsKey(projectName)) {
      createProject(projectName);
    }
    String key = projectName + "#" + robotName;
    return robots.computeIfAbsent(key, k -> new HarborRobotCredential(robotName, secretOf(k)));
  }

  private static String secretOf(String key) {
    UUID uuid = UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));
    return "mock-secret-" + uuid.toString().replace("-", "");
  }
}

