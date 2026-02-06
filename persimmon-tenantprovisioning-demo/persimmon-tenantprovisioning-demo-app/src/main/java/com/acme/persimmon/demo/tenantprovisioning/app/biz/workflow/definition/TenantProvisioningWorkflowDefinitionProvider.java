package com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.definition;

import com.acme.persimmon.demo.tenantprovisioning.app.biz.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.definition.WorkflowDefinition;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.definition.WorkflowDefinitionProvider;
import java.util.List;

public final class TenantProvisioningWorkflowDefinitionProvider implements WorkflowDefinitionProvider {
  @Override
  public WorkflowDefinition definition() {
    return new WorkflowDefinition(
        TenantProvisioningWorkflow.WORKFLOW_TYPE,
        TenantProvisioningWorkflow.WORKFLOW_VERSION,
        List.of(
            TenantProvisioningWorkflow.STEP_K8S_CREATE_NAMESPACE,
            TenantProvisioningWorkflow.STEP_HARBOR_CREATE_PROJECT,
            TenantProvisioningWorkflow.STEP_HARBOR_CREATE_ROBOT,
            TenantProvisioningWorkflow.STEP_K8S_CREATE_SECRET,
            TenantProvisioningWorkflow.STEP_TENANT_MARK_ACTIVE));
  }
}

