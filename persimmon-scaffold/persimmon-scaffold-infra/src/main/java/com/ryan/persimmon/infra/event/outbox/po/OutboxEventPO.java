package com.ryan.persimmon.infra.event.outbox.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.ryan.persimmon.infra.common.database.AuditTimestampsPO;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@TableName("outbox_event")
@Getter
@Setter
public class OutboxEventPO extends AuditTimestampsPO {
  @TableId(value = "event_id", type = IdType.INPUT)
  private UUID eventId;

  @TableField("occurred_at")
  private Instant occurredAt;

  @TableField("aggregate_type")
  private String aggregateType;

  @TableField("aggregate_id")
  private UUID aggregateId;

  @TableField("event_type")
  private String eventType;

  @TableField("payload")
  private String payload;

  @TableField("headers")
  private String headers;

  @TableField("status")
  private String status;

  @TableField("attempts")
  private Integer attempts;

  @TableField("next_retry_at")
  private Instant nextRetryAt;

  @TableField("sent_at")
  private Instant sentAt;

  @TableField("dead_at")
  private Instant deadAt;

  @TableField("locked_by")
  private String lockedBy;

  @TableField("locked_until")
  private Instant lockedUntil;

  @TableField("last_error")
  private String lastError;
}
