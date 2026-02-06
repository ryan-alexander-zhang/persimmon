package com.acme.persimmon.demo.tenantprovisioning.domain.biz.gateway;

public interface HarborGateway {
  void createProject(String projectName);

  HarborRobotCredential createRobot(String projectName, String robotName);

  record HarborRobotCredential(String robotName, String secret) {}
}

