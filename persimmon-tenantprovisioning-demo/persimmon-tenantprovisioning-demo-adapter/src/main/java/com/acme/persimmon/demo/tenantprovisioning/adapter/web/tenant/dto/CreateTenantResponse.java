package com.acme.persimmon.demo.tenantprovisioning.adapter.web.tenant.dto;

import java.util.UUID;

public record CreateTenantResponse(UUID tenantId, UUID workflowInstanceId) {}
