package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.step;

import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContext;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.id.UuidV7Generator;
import com.acme.persimmon.demo.tenantprovisioning.app.common.time.AppClock;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.StepResult;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.event.HarborProjectReadyEvent;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.gateway.HarborGateway;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;
import java.time.Duration;
import java.util.List;

public final class HarborCreateProjectStepHandler implements WorkflowStepHandler {
  private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(30);

  private final HarborGateway harborGateway;
  private final TenantProvisioningContextCodec contextCodec;
  private final UuidV7Generator uuidV7Generator;
  private final AppClock clock;

  public HarborCreateProjectStepHandler(
      HarborGateway harborGateway,
      TenantProvisioningContextCodec contextCodec,
      UuidV7Generator uuidV7Generator,
      AppClock clock) {
    this.harborGateway = harborGateway;
    this.contextCodec = contextCodec;
    this.uuidV7Generator = uuidV7Generator;
    this.clock = clock;
  }

  @Override
  public String workflowType() {
    return TenantProvisioningWorkflow.WORKFLOW_TYPE;
  }

  @Override
  public String stepType() {
    return TenantProvisioningWorkflow.STEP_HARBOR_CREATE_PROJECT;
  }

  @Override
  public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
    TenantProvisioningContext ctx = contextCodec.decode(instance.getContextJson());
    if (ctx.getHarborProjectName() == null || ctx.getHarborProjectName().isBlank()) {
      return StepResult.dead("MISSING_HARBOR_PROJECT_NAME");
    }
    if (ctx.getTenantId() == null) {
      return StepResult.dead("MISSING_TENANT_ID");
    }

    if (taskType == WorkflowTaskType.WAITING_TIMEOUT) {
      return StepResult.waiting(TenantProvisioningWorkflow.WAITING_EVENT_HARBOR_PROJECT_READY, DEFAULT_TIMEOUT, List.of());
    }

    if (!ctx.isHarborProjectRequested()) {
      harborGateway.createProject(ctx.getHarborProjectName());
      ctx.setHarborProjectRequested(true);
      instance.updateContextJson(contextCodec.encode(ctx));

      HarborProjectReadyEvent event =
          new HarborProjectReadyEvent(
              uuidV7Generator.next(),
              clock.now(),
              instance.getInstanceId(),
              ctx.getTenantId());
      return StepResult.waiting(
          TenantProvisioningWorkflow.WAITING_EVENT_HARBOR_PROJECT_READY,
          DEFAULT_TIMEOUT,
          List.of(event));
    }

    return StepResult.completed();
  }
}
