package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.step;

import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContext;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.id.UuidV7Generator;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.model.DomainEventContext;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.service.DomainEventOutboxService;
import com.acme.persimmon.demo.tenantprovisioning.app.common.time.AppClock;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.StepResult;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port.WorkflowStepHandler;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.aggregate.Tenant;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.vo.TenantId;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.enums.TenantStatus;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.repository.TenantRepository;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;
import java.time.Instant;
import java.util.Map;

public final class TenantMarkActiveStepHandler implements WorkflowStepHandler {
  private static final String AGGREGATE_TYPE_TENANT = "TENANT";

  private final TenantRepository tenantRepository;
  private final DomainEventOutboxService outboxService;
  private final TenantProvisioningContextCodec contextCodec;
  private final UuidV7Generator uuidV7Generator;
  private final AppClock clock;

  public TenantMarkActiveStepHandler(
      TenantRepository tenantRepository,
      DomainEventOutboxService outboxService,
      TenantProvisioningContextCodec contextCodec,
      UuidV7Generator uuidV7Generator,
      AppClock clock) {
    this.tenantRepository = tenantRepository;
    this.outboxService = outboxService;
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
    return TenantProvisioningWorkflow.STEP_TENANT_MARK_ACTIVE;
  }

  @Override
  public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) {
    TenantProvisioningContext ctx = contextCodec.decode(instance.getContextJson());
    if (ctx.getTenantId() == null) {
      return StepResult.dead("MISSING_TENANT_ID");
    }

    Tenant tenant =
        tenantRepository
            .findById(new TenantId(ctx.getTenantId()))
            .orElse(null);
    if (tenant == null) {
      return StepResult.dead("TENANT_NOT_FOUND");
    }
    if (tenant.getStatus() == TenantStatus.ACTIVE) {
      return StepResult.completed();
    }

    Instant now = clock.now();
    tenant.markActive(uuidV7Generator.next(), now);
    tenantRepository.save(tenant);
    outboxService.recordPulledDomainEvents(
        tenant, new DomainEventContext(AGGREGATE_TYPE_TENANT, ctx.getTenantId(), Map.of()));
    return StepResult.completed();
  }
}
