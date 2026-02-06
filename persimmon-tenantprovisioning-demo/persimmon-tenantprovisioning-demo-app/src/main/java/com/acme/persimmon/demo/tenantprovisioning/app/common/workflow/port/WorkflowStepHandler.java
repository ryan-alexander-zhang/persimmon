package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.port;

import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.StepResult;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTaskType;
import com.acme.persimmon.demo.tenantprovisioning.domain.common.workflow.WorkflowInstance;

public interface WorkflowStepHandler {
  String workflowType();

  String stepType();

  StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType);
}
