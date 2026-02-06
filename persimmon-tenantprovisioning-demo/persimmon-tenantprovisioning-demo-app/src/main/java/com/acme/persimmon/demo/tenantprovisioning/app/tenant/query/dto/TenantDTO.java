package com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.dto;

import java.util.UUID;

public record TenantDTO(UUID tenantId, String name, String email, String plan, String status) {}
