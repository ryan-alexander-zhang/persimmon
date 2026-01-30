package com.ryan.persimmon.infra.repository.biz.po;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@TableName("demo_biz")
@Getter
@Setter
public class DemoBizPO {
  @TableId(type = IdType.INPUT)
  private UUID id;

  private String status;

  @TableField("row_version")
  private Integer rowVersion;

  private String name;

  @TableField("created_at")
  private Instant createdAt;

  @TableField("updated_at")
  private Instant updatedAt;

  @TableField("created_by")
  private UUID createdBy;

  @TableField("updated_by")
  private UUID updatedBy;

  @TableField("deleted_at")
  private Instant deletedAt;
}
