package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.definition;

import java.util.List;

/**
 * Code-defined strict linear workflow (responsibility chain).
 *
 * <p>Branching/DAG is intentionally out of scope.
 */
public final class WorkflowDefinition {
  private final String workflowType;
  private final int version;
  private final List<String> stepTypes;

  public WorkflowDefinition(String workflowType, int version, List<String> stepTypes) {
    if (workflowType == null || workflowType.isBlank()) {
      throw new IllegalArgumentException("workflowType must not be blank.");
    }
    if (version <= 0) {
      throw new IllegalArgumentException("version must be positive.");
    }
    if (stepTypes == null || stepTypes.isEmpty()) {
      throw new IllegalArgumentException("stepTypes must not be empty.");
    }
    for (String stepType : stepTypes) {
      if (stepType == null || stepType.isBlank()) {
        throw new IllegalArgumentException("stepType must not be blank.");
      }
    }
    this.workflowType = workflowType;
    this.version = version;
    this.stepTypes = List.copyOf(stepTypes);
  }

  public String workflowType() {
    return workflowType;
  }

  public int version() {
    return version;
  }

  public String stepTypeAt(int stepSeq) {
    return stepTypes.get(stepSeq);
  }

  public int size() {
    return stepTypes.size();
  }

  public boolean hasNext(int stepSeq) {
    return stepSeq + 1 < stepTypes.size();
  }

  public int nextSeq(int stepSeq) {
    return stepSeq + 1;
  }
}
