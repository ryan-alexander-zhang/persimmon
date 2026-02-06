package com.acme.persimmon.demo.tenantprovisioning.infra.event.inbox.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.AuditTimestampsPO;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@TableName("inbox_event")
@Getter
@Setter
public class InboxEventPO extends AuditTimestampsPO {
  @TableId(value = "id", type = IdType.INPUT)
  private UUID id;

  @TableField("event_id")
  private UUID eventId;

  @TableField("consumer_name")
  private String consumerName;

  @TableField("event_type")
  private String eventType;

  @TableField("occurred_at")
  private Instant occurredAt;

  @TableField("aggregate_type")
  private String aggregateType;

  @TableField("aggregate_id")
  private UUID aggregateId;

  @TableField("status")
  private String status;

  @TableField("started_at")
  private Instant startedAt;

  @TableField("processed_at")
  private Instant processedAt;

  @TableField("dead_at")
  private Instant deadAt;

  @TableField("last_error")
  private String lastError;
}
