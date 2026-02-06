package com.acme.persimmon.demo.tenantprovisioning.domain.tenant.gateway;

public interface HarborGateway {
  void createProject(String projectName);

  HarborRobotCredential createRobot(String projectName, String robotName);

  record HarborRobotCredential(String robotName, String secret) {}
}
