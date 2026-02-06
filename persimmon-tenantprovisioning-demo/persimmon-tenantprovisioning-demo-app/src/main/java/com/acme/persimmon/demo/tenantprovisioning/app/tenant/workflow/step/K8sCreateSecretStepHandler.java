package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.step;

import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContext;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.StepResult;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.gateway.KubernetesGateway;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;
import java.util.Map;

public final class K8sCreateSecretStepHandler implements WorkflowStepHandler {
  private static final String SECRET_NAME = "harbor-robot";

  private final KubernetesGateway kubernetesGateway;
  private final TenantProvisioningContextCodec contextCodec;

  public K8sCreateSecretStepHandler(
      KubernetesGateway kubernetesGateway, TenantProvisioningContextCodec contextCodec) {
    this.kubernetesGateway = kubernetesGateway;
    this.contextCodec = contextCodec;
  }

  @Override
  public String workflowType() {
    return TenantProvisioningWorkflow.WORKFLOW_TYPE;
  }

  @Override
  public String stepType() {
    return TenantProvisioningWorkflow.STEP_K8S_CREATE_SECRET;
  }

  @Override
  public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
    TenantProvisioningContext ctx = contextCodec.decode(instance.getContextJson());
    if (ctx.getNamespace() == null || ctx.getNamespace().isBlank()) {
      return StepResult.dead("MISSING_NAMESPACE");
    }
    if (ctx.getHarborRobotSecret() == null || ctx.getHarborRobotSecret().isBlank()) {
      return StepResult.retry("MISSING_HARBOR_ROBOT_SECRET");
    }

    kubernetesGateway.createSecret(
        ctx.getNamespace(), SECRET_NAME, Map.of("robotSecret", ctx.getHarborRobotSecret()));
    return StepResult.completed();
  }
}
