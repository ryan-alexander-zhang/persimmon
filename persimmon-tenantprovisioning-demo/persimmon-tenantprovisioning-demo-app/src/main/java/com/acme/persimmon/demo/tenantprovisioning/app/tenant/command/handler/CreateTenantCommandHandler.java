package com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.handler;

import com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.dto.CreateTenantCommand;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.dto.CreateTenantResult;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContext;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningContextCodec;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.id.UuidV7Generator;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.model.DomainEventContext;
import com.acme.persimmon.demo.tenantprovisioning.app.common.outbox.service.DomainEventOutboxService;
import com.acme.persimmon.demo.tenantprovisioning.app.common.time.AppClock;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.service.WorkflowStartService;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.aggregate.Tenant;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.vo.TenantId;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.repository.TenantRepository;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

public class CreateTenantCommandHandler {
  private static final String AGGREGATE_TYPE_TENANT = "TENANT";

  private final TenantRepository tenantRepository;
  private final WorkflowStartService workflowStartService;
  private final DomainEventOutboxService outboxService;
  private final TenantProvisioningContextCodec contextCodec;
  private final UuidV7Generator uuidV7Generator;
  private final AppClock clock;

  public CreateTenantCommandHandler(
      TenantRepository tenantRepository,
      WorkflowStartService workflowStartService,
      DomainEventOutboxService outboxService,
      TenantProvisioningContextCodec contextCodec,
      UuidV7Generator uuidV7Generator,
      AppClock clock) {
    this.tenantRepository = tenantRepository;
    this.workflowStartService = workflowStartService;
    this.outboxService = outboxService;
    this.contextCodec = contextCodec;
    this.uuidV7Generator = uuidV7Generator;
    this.clock = clock;
  }

  @Transactional
  public CreateTenantResult handle(CreateTenantCommand cmd) {
    if (tenantRepository.existsByEmail(cmd.email())) {
      throw new IllegalStateException("Tenant email already exists: " + cmd.email());
    }

    Instant now = clock.now();
    UUID tenantUuid = uuidV7Generator.next();
    TenantId tenantId = new TenantId(tenantUuid);

    Tenant tenant =
        Tenant.create(
            tenantId, cmd.name(), cmd.email(), "BASIC", uuidV7Generator.next(), now);
    tenantRepository.save(tenant);
    outboxService.recordPulledDomainEvents(
        tenant, new DomainEventContext(AGGREGATE_TYPE_TENANT, tenantUuid, Map.of()));

    String bizKey = "tenant:" + tenantUuid;
    String contextJson = contextCodec.encode(initialContext(tenantUuid, cmd.name(), cmd.email()));
    UUID instanceId = workflowStartService.start(TenantProvisioningWorkflow.WORKFLOW_TYPE, bizKey, contextJson);
    return new CreateTenantResult(tenantUuid, instanceId);
  }

  private static TenantProvisioningContext initialContext(UUID tenantId, String name, String email) {
    TenantProvisioningContext ctx = new TenantProvisioningContext();
    ctx.setTenantId(tenantId);
    ctx.setTenantName(name);
    ctx.setEmail(email);
    ctx.setNamespace("tenant-" + tenantId);
    ctx.setHarborProjectName("tenant-" + tenantId);
    ctx.setHarborRobotName("robot-" + tenantId);
    ctx.setHarborProjectRequested(false);
    return ctx;
  }
}
