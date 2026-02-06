package com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.repository;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.aggregate.Tenant;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.model.vo.TenantId;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.repository.TenantRepository;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.converter.TenantConverter;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.mapper.TenantMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.po.TenantPO;
import java.util.Optional;

public class MybatisTenantRepository implements TenantRepository {
  private final TenantMapper tenantMapper;

  public MybatisTenantRepository(TenantMapper tenantMapper) {
    this.tenantMapper = tenantMapper;
  }

  @Override
  public boolean existsByEmail(String email) {
    if (email == null || email.isBlank()) {
      return false;
    }
    QueryWrapper<TenantPO> qw = new QueryWrapper<>();
    qw.eq("email", email).isNull("deleted_at");
    return tenantMapper.selectCount(qw) > 0;
  }

  @Override
  public void save(Tenant tenant) {
    TenantPO po = TenantConverter.toPO(tenant);
    TenantPO existing = tenantMapper.selectById(po.getId());
    if (existing == null) {
      tenantMapper.insert(po);
      return;
    }
    tenantMapper.updateById(po);
  }

  @Override
  public Optional<Tenant> findById(TenantId tenantId) {
    if (tenantId == null) {
      return Optional.empty();
    }
    TenantPO po = tenantMapper.selectById(tenantId.value());
    if (po == null || po.getDeletedAt() != null) {
      return Optional.empty();
    }
    return Optional.ofNullable(TenantConverter.toDomain(po));
  }
}
