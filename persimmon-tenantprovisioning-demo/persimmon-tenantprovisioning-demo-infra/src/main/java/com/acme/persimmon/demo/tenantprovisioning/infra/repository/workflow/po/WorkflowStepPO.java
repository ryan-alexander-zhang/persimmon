package com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.po;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.AuditTimestampsPO;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@TableName("workflow_step")
@Getter
@Setter
public class WorkflowStepPO extends AuditTimestampsPO {
  @TableField("instance_id")
  private UUID instanceId;

  @TableField("step_seq")
  private Integer stepSeq;

  @TableField("step_type")
  private String stepType;

  @TableField("status")
  private String status;

  @TableField("attempts")
  private Integer attempts;

  @TableField("max_attempts")
  private Integer maxAttempts;

  @TableField("next_run_at")
  private Instant nextRunAt;

  @TableField("waiting_event_type")
  private String waitingEventType;

  @TableField("deadline_at")
  private Instant deadlineAt;

  @TableField("locked_by")
  private String lockedBy;

  @TableField("locked_until")
  private Instant lockedUntil;

  @TableField("last_error")
  private String lastError;
}
