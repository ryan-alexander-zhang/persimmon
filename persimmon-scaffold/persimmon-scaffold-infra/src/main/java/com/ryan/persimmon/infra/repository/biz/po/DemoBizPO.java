package com.ryan.persimmon.infra.repository.biz.po;

import com.baomidou.mybatisplus.annotation.TableName;
import com.ryan.persimmon.infra.common.database.BasePO;
import lombok.Getter;
import lombok.Setter;

@TableName("demo_biz")
@Getter
@Setter
public class DemoBizPO extends BasePO {
  private String status;
  private String name;
}
