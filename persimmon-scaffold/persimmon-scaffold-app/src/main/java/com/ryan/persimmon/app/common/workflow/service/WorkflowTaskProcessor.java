package com.ryan.persimmon.app.common.workflow.service;

import com.ryan.persimmon.app.common.workflow.model.WorkflowTask;

@FunctionalInterface
public interface WorkflowTaskProcessor {
  void process(WorkflowTask task);
}
