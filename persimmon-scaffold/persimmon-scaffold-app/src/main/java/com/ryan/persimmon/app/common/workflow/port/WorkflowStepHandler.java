package com.ryan.persimmon.app.common.workflow.port;

import com.ryan.persimmon.app.common.workflow.model.StepResult;
import com.ryan.persimmon.app.common.workflow.model.WorkflowTaskType;
import com.ryan.persimmon.domain.common.workflow.WorkflowInstance;

public interface WorkflowStepHandler {
  String workflowType();

  String stepType();

  StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType);
}
