package com.acme.persimmon.demo.tenantprovisioning.app.biz.query.service;

import com.acme.persimmon.demo.tenantprovisioning.app.biz.port.out.TenantQueryPort;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.TenantDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.TenantProvisioningDTO;
import java.util.Optional;
import java.util.UUID;

public class TenantQueryService {
  private final TenantQueryPort tenantQueryPort;

  public TenantQueryService(TenantQueryPort tenantQueryPort) {
    this.tenantQueryPort = tenantQueryPort;
  }

  public Optional<TenantDTO> findTenant(UUID tenantId) {
    return tenantQueryPort.findTenant(tenantId);
  }

  public Optional<TenantProvisioningDTO> findProvisioning(UUID tenantId) {
    return tenantQueryPort.findTenantProvisioning(tenantId);
  }
}

