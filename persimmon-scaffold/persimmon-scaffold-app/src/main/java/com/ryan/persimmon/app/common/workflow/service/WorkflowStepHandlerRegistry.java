package com.ryan.persimmon.app.common.workflow.service;

import com.ryan.persimmon.app.common.workflow.port.WorkflowStepHandler;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public class WorkflowStepHandlerRegistry {
  private final Map<Key, WorkflowStepHandler> handlers = new HashMap<>();

  public WorkflowStepHandlerRegistry(List<WorkflowStepHandler> handlers) {
    if (handlers == null || handlers.isEmpty()) {
      return;
    }
    for (WorkflowStepHandler handler : handlers) {
      if (handler == null) {
        continue;
      }
      this.handlers.put(new Key(handler.workflowType(), handler.stepType()), handler);
    }
  }

  public WorkflowStepHandler require(String workflowType, String stepType) {
    WorkflowStepHandler handler = handlers.get(new Key(workflowType, stepType));
    if (handler == null) {
      throw new IllegalStateException("Workflow step handler not found: " + workflowType + "#" + stepType);
    }
    return handler;
  }

  public boolean has(String workflowType, String stepType) {
    return handlers.containsKey(new Key(workflowType, stepType));
  }

  private record Key(String workflowType, String stepType) {
    private Key {
      Objects.requireNonNull(workflowType, "workflowType");
      Objects.requireNonNull(stepType, "stepType");
    }
  }
}
