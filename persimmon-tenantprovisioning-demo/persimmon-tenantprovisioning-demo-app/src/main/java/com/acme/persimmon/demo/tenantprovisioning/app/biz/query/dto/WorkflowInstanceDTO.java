package com.acme.persimmon.demo.tenantprovisioning.app.biz.query.dto;

import java.time.Instant;
import java.util.UUID;

public record WorkflowInstanceDTO(
    UUID instanceId,
    String bizKey,
    String workflowType,
    int workflowVersion,
    String status,
    int currentStepSeq,
    String currentStepType,
    String contextJson,
    Instant startedAt,
    Instant completedAt,
    Instant failedAt) {}

