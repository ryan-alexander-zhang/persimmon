package com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

public final class TenantProvisioningContextCodec {
  private final ObjectMapper objectMapper;

  public TenantProvisioningContextCodec(ObjectMapper objectMapper) {
    if (objectMapper == null) {
      throw new IllegalArgumentException("objectMapper must not be null.");
    }
    this.objectMapper = objectMapper;
  }

  public TenantProvisioningContext decode(String contextJson) {
    if (contextJson == null || contextJson.isBlank()) {
      return new TenantProvisioningContext();
    }
    try {
      return objectMapper.readValue(contextJson, TenantProvisioningContext.class);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid workflow contextJson.", e);
    }
  }

  public String encode(TenantProvisioningContext ctx) {
    try {
      return objectMapper.writeValueAsString(ctx);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to serialize workflow contextJson.", e);
    }
  }
}
