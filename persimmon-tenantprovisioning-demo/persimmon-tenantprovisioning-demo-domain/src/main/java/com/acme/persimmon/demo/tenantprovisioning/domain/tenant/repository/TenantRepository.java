package com.acme.persimmon.demo.tenantprovisioning.domain.tenant.repository;

import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.aggregate.Tenant;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.vo.TenantId;
import java.util.Optional;

public interface TenantRepository {
  boolean existsByEmail(String email);

  void save(Tenant tenant);

  Optional<Tenant> findById(TenantId tenantId);
}
