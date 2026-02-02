package com.ryan.persimmon.start.config.scan;

import lombok.extern.slf4j.Slf4j;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@Slf4j
@MapperScan(
    basePackages = {
      "com.ryan.persimmon.infra.repository",
      "com.ryan.persimmon.infra.query",
      "com.ryan.persimmon.infra.event.outbox",
      "com.ryan.persimmon.infra.event.inbox"
    })
public class MybatisMapperScanConfig {

  public MybatisMapperScanConfig() {
    log.info("MybatisMapperScanConfig init");
  }
}
