package com.acme.persimmon.demo.tenantprovisioning.adapter.web.tenant.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record CreateTenantRequest(@NotBlank String name, @NotBlank @Email String email) {}
