package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class WorkflowTaskTest {

  @Test
  void record_isValueBased() {
    UUID instanceId = UUID.fromString("019c0e02-a181-786f-8d5b-11c4de115fb6");
    WorkflowTask a = new WorkflowTask(WorkflowTaskType.READY_STEP, instanceId, 0, "s1", 1, 3);
    WorkflowTask b = new WorkflowTask(WorkflowTaskType.READY_STEP, instanceId, 0, "s1", 1, 3);
    WorkflowTask c = new WorkflowTask(WorkflowTaskType.READY_STEP, instanceId, 1, "s2", 0, 3);

    assertEquals(a, b);
    assertEquals(a.hashCode(), b.hashCode());
    assertNotEquals(a, c);
  }
}
