package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow;

public final class TenantProvisioningWorkflow {
  private TenantProvisioningWorkflow() {}

  public static final String WORKFLOW_TYPE = "tenant.provision.v1";
  public static final int WORKFLOW_VERSION = 1;

  public static final String STEP_K8S_CREATE_NAMESPACE = "K8S_CREATE_NAMESPACE";
  public static final String STEP_HARBOR_CREATE_PROJECT = "HARBOR_CREATE_PROJECT";
  public static final String STEP_HARBOR_CREATE_ROBOT = "HARBOR_CREATE_ROBOT";
  public static final String STEP_K8S_CREATE_SECRET = "K8S_CREATE_SECRET";
  public static final String STEP_TENANT_MARK_ACTIVE = "TENANT_MARK_ACTIVE";

  public static final String WAITING_EVENT_HARBOR_PROJECT_READY = "harbor.project.ready.v1";
}
