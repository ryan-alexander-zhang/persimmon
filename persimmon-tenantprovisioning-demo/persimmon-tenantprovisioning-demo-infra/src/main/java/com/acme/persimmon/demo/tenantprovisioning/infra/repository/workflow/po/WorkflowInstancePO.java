package com.acme.persimmon.demo.tenantprovisioning.infra.repository.workflow.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.AuditTimestampsPO;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@TableName("workflow_instance")
@Getter
@Setter
public class WorkflowInstancePO extends AuditTimestampsPO {
  @TableId(value = "instance_id", type = IdType.INPUT)
  private UUID instanceId;

  @TableField("biz_key")
  private String bizKey;

  @TableField("workflow_type")
  private String workflowType;

  @TableField("workflow_version")
  private Integer workflowVersion;

  @TableField("status")
  private String status;

  @TableField("current_step_seq")
  private Integer currentStepSeq;

  @TableField("current_step_type")
  private String currentStepType;

  @TableField("context_json")
  private String contextJson;

  @TableField("started_at")
  private Instant startedAt;

  @TableField("completed_at")
  private Instant completedAt;

  @TableField("failed_at")
  private Instant failedAt;
}
