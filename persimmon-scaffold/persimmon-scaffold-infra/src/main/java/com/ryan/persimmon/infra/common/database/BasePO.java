package com.ryan.persimmon.infra.common.database;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BasePO {
  @TableId(type = IdType.INPUT)
  private UUID id;

  @TableField("row_version")
  private Integer rowVersion;

  @TableField(value = "created_at", fill = FieldFill.INSERT)
  private Instant createdAt;

  @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
  private Instant updatedAt;

  @TableField("deleted_at")
  private Instant deletedAt;

  @TableField("created_by")
  private UUID createdBy;

  @TableField("updated_by")
  private UUID updatedBy;
}
