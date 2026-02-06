package com.acme.persimmon.demo.tenantprovisioning.domain.tenant.gateway;

import java.util.Map;

public interface KubernetesGateway {
  void createNamespace(String namespace);

  void createSecret(String namespace, String secretName, Map<String, String> data);
}
