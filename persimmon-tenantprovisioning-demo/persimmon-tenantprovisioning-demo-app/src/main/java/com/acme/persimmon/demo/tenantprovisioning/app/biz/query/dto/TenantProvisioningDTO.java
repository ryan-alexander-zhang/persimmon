package com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto;

import java.util.List;
import java.util.UUID;

public record TenantProvisioningDTO(UUID tenantId, WorkflowInstanceDTO workflow, List<WorkflowStepDTO> steps) {
  public TenantProvisioningDTO {
    steps = steps == null ? List.of() : List.copyOf(steps);
  }
}

