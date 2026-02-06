package com.acme.persimmon.demo.tenantprovisioning.app.common.workflow.model;

import java.util.UUID;

public record WorkflowTask(
    WorkflowTaskType type,
    UUID instanceId,
    int stepSeq,
    String stepType,
    int attempts,
    int maxAttempts) {}
