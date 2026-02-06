package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.definition;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

class WorkflowDefinitionRegistryTest {

  @Test
  void emptyRegistry_requireLatestThrows() {
    WorkflowDefinitionRegistry registry = new WorkflowDefinitionRegistry(null);
    assertThrows(IllegalStateException.class, () -> registry.requireLatest("demo"));
  }

  @Test
  void ignoresNullProvidersAndNullDefinitions() {
    WorkflowDefinitionProvider p1 = () -> null;
    java.util.List<WorkflowDefinitionProvider> providers = new java.util.ArrayList<>();
    providers.add(null);
    providers.add(p1);
    WorkflowDefinitionRegistry registry = new WorkflowDefinitionRegistry(providers);
    assertThrows(IllegalStateException.class, () -> registry.requireLatest("demo"));
  }

  @Test
  void requireAndRequireLatest_work() {
    WorkflowDefinition v1 = new WorkflowDefinition("demo", 1, List.of("s1"));
    WorkflowDefinition v2 = new WorkflowDefinition("demo", 2, List.of("s1", "s2"));
    WorkflowDefinition other = new WorkflowDefinition("other", 1, List.of("x"));

    WorkflowDefinitionRegistry registry =
        new WorkflowDefinitionRegistry(List.of(() -> v1, () -> v2, () -> other));

    assertEquals(1, registry.require("demo", 1).version());
    assertEquals(2, registry.require("demo", 2).version());
    assertEquals(2, registry.requireLatest("demo").version());
    assertEquals(1, registry.requireLatest("other").version());
  }

  @Test
  void require_missingThrows() {
    WorkflowDefinitionRegistry registry =
        new WorkflowDefinitionRegistry(
            List.of(() -> new WorkflowDefinition("demo", 1, List.of("s1"))));
    assertThrows(IllegalStateException.class, () -> registry.require("demo", 2));
    assertThrows(IllegalStateException.class, () -> registry.requireLatest("missing"));
  }
}
