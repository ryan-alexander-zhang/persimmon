package com.acme.persimmon.demo.tenantprovisioning.app.tenant.event.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.acme.persimmon.demo.tenantprovisioning.app.tenant.workflow.TenantProvisioningWorkflow;
import com.acme.persimmon.demo.tenantprovisioning.app.common.event.exception.EventHandlingException;
import com.acme.persimmon.demo.tenantprovisioning.app.common.event.model.ConsumedEvent;
import com.acme.persimmon.demo.tenantprovisioning.app.common.event.port.EventHandler;
import com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.service.WorkflowSignalService;
import com.acme.persimmon.demo.tenantprovisioning.domain.tenant.event.HarborProjectReadyEvent;
import java.util.UUID;

public final class HarborProjectReadyEventHandler implements EventHandler {
  private final WorkflowSignalService workflowSignalService;
  private final ObjectMapper objectMapper;

  public HarborProjectReadyEventHandler(
      WorkflowSignalService workflowSignalService, ObjectMapper objectMapper) {
    this.workflowSignalService = workflowSignalService;
    this.objectMapper = objectMapper;
  }

  @Override
  public String eventType() {
    return TenantProvisioningWorkflow.WAITING_EVENT_HARBOR_PROJECT_READY;
  }

  @Override
  public void handle(ConsumedEvent event) {
    HarborProjectReadyEvent payload = decode(event.payload());
    UUID instanceId = payload.workflowInstanceId();
    boolean ok =
        workflowSignalService.signal(
            instanceId, TenantProvisioningWorkflow.WAITING_EVENT_HARBOR_PROJECT_READY);
    if (!ok) {
      throw EventHandlingException.retryable(
          "WORKFLOW_STEP_NOT_WAITING",
          "No waiting step found for signal: instanceId=" + instanceId,
          null);
    }
  }

  private HarborProjectReadyEvent decode(String payload) {
    try {
      return objectMapper.readValue(payload, HarborProjectReadyEvent.class);
    } catch (Exception e) {
      throw EventHandlingException.nonRetryable(
          "INVALID_PAYLOAD", "Failed to parse event payload.", e);
    }
  }
}
