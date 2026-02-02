package com.ryan.persimmon.infra.common.database;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/**
 * Shared audit timestamp columns.
 *
 * <p>Intended for tables that want created/updated timestamps but do not necessarily share the same
 * primary key or soft-delete/versioning scheme.
 */
@Getter
@Setter
public class AuditTimestampsPO {

  @TableField(value = "created_at", fill = FieldFill.INSERT)
  private Instant createdAt;

  @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
  private Instant updatedAt;
}

