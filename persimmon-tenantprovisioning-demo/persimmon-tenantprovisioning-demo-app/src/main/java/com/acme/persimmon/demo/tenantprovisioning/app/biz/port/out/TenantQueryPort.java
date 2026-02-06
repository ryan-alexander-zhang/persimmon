package com.acme.persimmon.demo.tenantprovisioning.app.biz.port.out;

import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.TenantDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto.TenantProvisioningDTO;
import java.util.Optional;
import java.util.UUID;

public interface TenantQueryPort {
  Optional<TenantDTO> findTenant(UUID tenantId);

  Optional<TenantProvisioningDTO> findTenantProvisioning(UUID tenantId);
}

