package com.acme.persimmon.demo.tenantprovisioning.infra.common.database;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class BasePO extends AuditTimestampsPO {
  @TableId(type = IdType.INPUT)
  private UUID id;

  @Version
  @TableField("row_version")
  private Integer rowVersion;

  @TableField("deleted_at")
  private Instant deletedAt;

  @TableField("created_by")
  private UUID createdBy;

  @TableField("updated_by")
  private UUID updatedBy;
}
