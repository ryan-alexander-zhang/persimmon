package com.acme.persimmon.demo.tenantprovisioning.domain.biz.repository;

import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.aggregate.Tenant;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.vo.TenantId;
import java.util.Optional;

public interface TenantRepository {
  boolean existsByEmail(String email);

  void save(Tenant tenant);

  Optional<Tenant> findById(TenantId tenantId);
}

