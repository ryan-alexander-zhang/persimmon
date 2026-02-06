package com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.step;

import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.TenantProvisioningContext;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.StepResult;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.gateway.KubernetesGateway;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;

public final class K8sCreateNamespaceStepHandler implements WorkflowStepHandler {
  private final KubernetesGateway kubernetesGateway;
  private final TenantProvisioningContextCodec contextCodec;

  public K8sCreateNamespaceStepHandler(
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
    return TenantProvisioningWorkflow.STEP_K8S_CREATE_NAMESPACE;
  }

  @Override
  public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
    TenantProvisioningContext ctx = contextCodec.decode(instance.getContextJson());
    if (ctx.getNamespace() == null || ctx.getNamespace().isBlank()) {
      return StepResult.dead("MISSING_NAMESPACE");
    }
    kubernetesGateway.createNamespace(ctx.getNamespace());
    return StepResult.completed();
  }
}

