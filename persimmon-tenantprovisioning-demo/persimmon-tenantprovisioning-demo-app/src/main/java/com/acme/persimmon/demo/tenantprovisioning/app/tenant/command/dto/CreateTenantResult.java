package com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.dto;

import java.util.UUID;

public record CreateTenantResult(UUID tenantId, UUID workflowInstanceId) {
  public CreateTenantResult {
    if (tenantId == null) {
      throw new IllegalArgumentException("tenantId must not be null.");
    }
    if (workflowInstanceId == null) {
      throw new IllegalArgumentException("workflowInstanceId must not be null.");
    }
  }
}
