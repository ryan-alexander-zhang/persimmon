package com.acme.persimmon.demo.tenantprovisioning.app.tenant.query.dto;

import java.time.Instant;

public record WorkflowStepDTO(
    int stepSeq,
    String stepType,
    String status,
    int attempts,
    int maxAttempts,
    Instant nextRunAt,
    String waitingEventType,
    Instant deadlineAt,
    String lockedBy,
    Instant lockedUntil,
    String lastError) {}
