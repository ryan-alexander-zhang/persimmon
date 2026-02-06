package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow;

import java.util.UUID;

public class TenantProvisioningContext {
  private UUID tenantId;
  private String tenantName;
  private String email;
  private String namespace;
  private String harborProjectName;
  private boolean harborProjectRequested;
  private String harborRobotName;
  private String harborRobotSecret;

  public UUID getTenantId() {
    return tenantId;
  }

  public void setTenantId(UUID tenantId) {
    this.tenantId = tenantId;
  }

  public String getTenantName() {
    return tenantName;
  }

  public void setTenantName(String tenantName) {
    this.tenantName = tenantName;
  }

  public String getEmail() {
    return email;
  }

  public void setEmail(String email) {
    this.email = email;
  }

  public String getNamespace() {
    return namespace;
  }

  public void setNamespace(String namespace) {
    this.namespace = namespace;
  }

  public String getHarborProjectName() {
    return harborProjectName;
  }

  public void setHarborProjectName(String harborProjectName) {
    this.harborProjectName = harborProjectName;
  }

  public boolean isHarborProjectRequested() {
    return harborProjectRequested;
  }

  public void setHarborProjectRequested(boolean harborProjectRequested) {
    this.harborProjectRequested = harborProjectRequested;
  }

  public String getHarborRobotName() {
    return harborRobotName;
  }

  public void setHarborRobotName(String harborRobotName) {
    this.harborRobotName = harborRobotName;
  }

  public String getHarborRobotSecret() {
    return harborRobotSecret;
  }

  public void setHarborRobotSecret(String harborRobotSecret) {
    this.harborRobotSecret = harborRobotSecret;
  }
}
