package com.ryan.persimmon.app.common.workflow.definition;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class WorkflowDefinitionRegistry {
  private final Map<Key, WorkflowDefinition> definitions = new HashMap<>();
  private final Map<String, Integer> latestVersionByType = new HashMap<>();

  public WorkflowDefinitionRegistry(List<WorkflowDefinitionProvider> providers) {
    if (providers == null || providers.isEmpty()) {
      return;
    }
    for (WorkflowDefinitionProvider provider : providers) {
      if (provider == null) {
        continue;
      }
      WorkflowDefinition def = provider.definition();
      if (def == null) {
        continue;
      }
      definitions.put(new Key(def.workflowType(), def.version()), def);
      latestVersionByType.merge(def.workflowType(), def.version(), Math::max);
    }
  }

  public WorkflowDefinition requireLatest(String workflowType) {
    Integer version = latestVersionByType.get(workflowType);
    if (version == null) {
      throw new IllegalStateException("Workflow definition not found: " + workflowType);
    }
    return require(workflowType, version);
  }

  public WorkflowDefinition require(String workflowType, int version) {
    WorkflowDefinition def = definitions.get(new Key(workflowType, version));
    if (def == null) {
      throw new IllegalStateException(
          "Workflow definition not found: " + workflowType + " v" + version);
    }
    return def;
  }

  private record Key(String workflowType, int version) {
    private Key {
      Objects.requireNonNull(workflowType, "workflowType");
    }
  }
}
