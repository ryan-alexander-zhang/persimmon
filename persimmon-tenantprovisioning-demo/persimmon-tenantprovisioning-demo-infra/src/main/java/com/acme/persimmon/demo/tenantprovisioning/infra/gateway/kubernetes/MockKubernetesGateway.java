package com.acme.persimmon.demo.tenantprovisioning.infra.gateway.kubernetes;

import com.acme.persimmon.demo.tenantprovisioning.domain.biz.gateway.KubernetesGateway;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class MockKubernetesGateway implements KubernetesGateway {
  private final Map<String, Boolean> namespaces = new ConcurrentHashMap<>();
  private final Map<String, Map<String, String>> secrets = new ConcurrentHashMap<>();

  @Override
  public void createNamespace(String namespace) {
    if (namespace == null || namespace.isBlank()) {
      throw new IllegalArgumentException("namespace must not be blank.");
    }
    namespaces.putIfAbsent(namespace, Boolean.TRUE);
  }

  @Override
  public void createSecret(String namespace, String secretName, Map<String, String> data) {
    if (namespace == null || namespace.isBlank()) {
      throw new IllegalArgumentException("namespace must not be blank.");
    }
    if (secretName == null || secretName.isBlank()) {
      throw new IllegalArgumentException("secretName must not be blank.");
    }
    createNamespace(namespace);
    String key = namespace + "#" + secretName;
    secrets.putIfAbsent(key, data == null ? Map.of() : Map.copyOf(data));
  }
}

