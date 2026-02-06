package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.step;

import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContext;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.StepResult;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.gateway.HarborGateway;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;

public final class HarborCreateRobotStepHandler implements WorkflowStepHandler {
  private final HarborGateway harborGateway;
  private final TenantProvisioningContextCodec contextCodec;

  public HarborCreateRobotStepHandler(
      HarborGateway harborGateway, TenantProvisioningContextCodec contextCodec) {
    this.harborGateway = harborGateway;
    this.contextCodec = contextCodec;
  }

  @Override
  public String workflowType() {
    return TenantProvisioningWorkflow.WORKFLOW_TYPE;
  }

  @Override
  public String stepType() {
    return TenantProvisioningWorkflow.STEP_HARBOR_CREATE_ROBOT;
  }

  @Override
  public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
    TenantProvisioningContext ctx = contextCodec.decode(instance.getContextJson());
    if (ctx.getHarborProjectName() == null || ctx.getHarborProjectName().isBlank()) {
      return StepResult.dead("MISSING_HARBOR_PROJECT_NAME");
    }
    if (ctx.getHarborRobotName() == null || ctx.getHarborRobotName().isBlank()) {
      return StepResult.dead("MISSING_HARBOR_ROBOT_NAME");
    }
    if (ctx.getHarborRobotSecret() != null && !ctx.getHarborRobotSecret().isBlank()) {
      return StepResult.completed();
    }

    HarborGateway.HarborRobotCredential credential =
        harborGateway.createRobot(ctx.getHarborProjectName(), ctx.getHarborRobotName());
    if (credential == null || credential.secret() == null || credential.secret().isBlank()) {
      return StepResult.retry("HARBOR_ROBOT_SECRET_EMPTY");
    }

    ctx.setHarborRobotSecret(credential.secret());
    instance.updateContextJson(contextCodec.encode(ctx));
    return StepResult.completed();
  }
}
