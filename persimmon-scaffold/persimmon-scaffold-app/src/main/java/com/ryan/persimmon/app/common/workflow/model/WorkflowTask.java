package com.ryan.persimmon.app.common.workflow.model;

import java.util.UUID;

public record WorkflowTask(
    WorkflowTaskType type, UUID instanceId, int stepSeq, String stepType, int attempts, int maxAttempts) {}
