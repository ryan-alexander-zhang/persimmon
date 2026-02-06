package com.acme.persimmon.demo.tenantprovisioning.app.tenant.port.out;

import com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.dto.TenantDTO;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.dto.TenantProvisioningDTO;
import java.util.Optional;
import java.util.UUID;

public interface TenantQueryPort {
  Optional<TenantDTO> findTenant(UUID tenantId);

  Optional<TenantProvisioningDTO> findTenantProvisioning(UUID tenantId);
}
