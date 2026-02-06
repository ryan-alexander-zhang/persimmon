package com.acme.persimmon.demo.tenantprovisioning.start.config.scan;

import lombok.extern.slf4j.Slf4j;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@Slf4j
@MapperScan(
    basePackages = {
      "com.acme.persimmon.demo.tenantprovisioning.infra.repository",
      "com.acme.persimmon.demo.tenantprovisioning.infra.query",
      "com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox",
      "com.acme.persimmon.demo.tenantprovisioning.infra.event.inbox"
    })
public class MybatisMapperScanConfig {

  public MybatisMapperScanConfig() {
    log.info("MybatisMapperScanConfig init");
  }
}
