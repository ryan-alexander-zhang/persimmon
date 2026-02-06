package com.acme.persimmon.demo.tenantprovisioning.infra.common.database;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import java.time.Instant;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

@Component
public class AutoFillObjectHandler implements MetaObjectHandler {

  @Override
  public void insertFill(MetaObject metaObject) {
    this.strictInsertFill(metaObject, "createdAt", Instant.class, Instant.now());
    this.strictUpdateFill(metaObject, "updatedAt", Instant.class, Instant.now());
  }

  @Override
  public void updateFill(MetaObject metaObject) {
    this.strictUpdateFill(metaObject, "updatedAt", Instant.class, Instant.now());
  }
}
