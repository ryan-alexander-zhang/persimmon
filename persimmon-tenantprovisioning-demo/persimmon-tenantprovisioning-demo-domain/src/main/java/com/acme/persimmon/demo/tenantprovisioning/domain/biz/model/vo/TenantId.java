package com.acme.persimmon.demo.tenantprovisioning.domain.biz.model.vo;

import com.acme.persimmon.demo.tenantprovisioning.domain.common.id.UuidV7Id;
import java.util.UUID;

public final class TenantId extends UuidV7Id {
  public TenantId(UUID value) {
    super(value);
  }
}

