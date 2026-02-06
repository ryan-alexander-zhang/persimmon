package com.acme.persimmon.demo.tenantprovisioning.infra.query.tenant.impl;

import com.acme.persimmon.demo.tenantprovisioning.app.biz.port.out.TenantQueryPort;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.TenantDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.TenantProvisioningDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.WorkflowInstanceDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.WorkflowStepDTO;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.mapper.TenantMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.po.TenantPO;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper.WorkflowInstanceMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.mapper.WorkflowStepMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.po.WorkflowInstancePO;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.po.WorkflowStepPO;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class MybatisTenantQueryPort implements TenantQueryPort {
  private final TenantMapper tenantMapper;
  private final WorkflowInstanceMapper workflowInstanceMapper;
  private final WorkflowStepMapper workflowStepMapper;

  public MybatisTenantQueryPort(
      TenantMapper tenantMapper,
      WorkflowInstanceMapper workflowInstanceMapper,
      WorkflowStepMapper workflowStepMapper) {
    this.tenantMapper = tenantMapper;
    this.workflowInstanceMapper = workflowInstanceMapper;
    this.workflowStepMapper = workflowStepMapper;
  }

  @Override
  public Optional<TenantDTO> findTenant(UUID tenantId) {
    if (tenantId == null) {
      return Optional.empty();
    }
    TenantPO po = tenantMapper.selectById(tenantId);
    if (po == null || po.getDeletedAt() != null) {
      return Optional.empty();
    }
    return Optional.of(new TenantDTO(po.getId(), po.getName(), po.getEmail(), po.getPlan(), po.getStatus()));
  }

  @Override
  public Optional<TenantProvisioningDTO> findTenantProvisioning(UUID tenantId) {
    if (tenantId == null) {
      return Optional.empty();
    }
    WorkflowInstancePO instance = workflowInstanceMapper.selectLatestByBizKey("tenant:" + tenantId);
    if (instance == null) {
      return Optional.empty();
    }
    List<WorkflowStepPO> steps = workflowStepMapper.selectByInstanceId(instance.getInstanceId());

    WorkflowInstanceDTO workflowDto =
        new WorkflowInstanceDTO(
            instance.getInstanceId(),
            instance.getBizKey(),
            instance.getWorkflowType(),
            instance.getWorkflowVersion(),
            instance.getStatus(),
            instance.getCurrentStepSeq() == null ? 0 : instance.getCurrentStepSeq(),
            instance.getCurrentStepType(),
            instance.getContextJson(),
            instance.getStartedAt(),
            instance.getCompletedAt(),
            instance.getFailedAt());

    List<WorkflowStepDTO> stepDtos =
        steps.stream()
            .map(
                it ->
                    new WorkflowStepDTO(
                        it.getStepSeq(),
                        it.getStepType(),
                        it.getStatus(),
                        it.getAttempts() == null ? 0 : it.getAttempts(),
                        it.getMaxAttempts() == null ? 0 : it.getMaxAttempts(),
                        it.getNextRunAt(),
                        it.getWaitingEventType(),
                        it.getDeadlineAt(),
                        it.getLockedBy(),
                        it.getLockedUntil(),
                        it.getLastError()))
            .toList();

    return Optional.of(new TenantProvisioningDTO(tenantId, workflowDto, stepDtos));
  }
}

