package com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.converter;

import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.aggregate.Tenant;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.enums.TenantStatus;
import com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.vo.TenantId;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.po.TenantPO;

public final class TenantConverter {
  private TenantConverter() {}

  public static TenantPO toPO(Tenant tenant) {
    TenantPO po = new TenantPO();
    po.setId(tenant.id().value());
    po.setName(tenant.getName());
    po.setEmail(tenant.getEmail());
    po.setPlan(tenant.getPlan());
    po.setStatus(tenant.getStatus().name());
    long v = tenant.version();
    if (v >= 0 && v <= Integer.MAX_VALUE) {
      po.setRowVersion((int) v);
    }
    return po;
  }

  public static Tenant toDomain(TenantPO po) {
    if (po == null) {
      return null;
    }
    long version = po.getRowVersion() == null ? -1 : po.getRowVersion().longValue();
    return Tenant.rehydrate(
        new TenantId(po.getId()),
        po.getName(),
        po.getEmail(),
        po.getPlan(),
        TenantStatus.valueOf(po.getStatus()),
        version);
  }
}

