package com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.po;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.database.BasePO;
import lombok.Getter;
import lombok.Setter;

@TableName("tenant")
@Getter
@Setter
public class TenantPO extends BasePO {
  private String status;
  private String name;
  private String email;

  @TableField("plan")
  private String plan;
}

