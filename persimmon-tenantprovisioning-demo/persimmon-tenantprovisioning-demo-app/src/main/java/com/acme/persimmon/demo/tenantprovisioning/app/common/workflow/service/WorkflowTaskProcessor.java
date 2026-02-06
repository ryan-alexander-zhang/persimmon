package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.service;

import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model.WorkflowTask;

@FunctionalInterface
public interface WorkflowTaskProcessor {
  void process(WorkflowTask task);
}
