package com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.dto;

public record CreateTenantCommand(String name, String email) {
  public CreateTenantCommand {
    if (name == null || name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank.");
    }
    if (email == null || email.isBlank()) {
      throw new IllegalArgumentException("email must not be blank.");
    }
  }
}
