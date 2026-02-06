package com.acme.persimmon.demo.tenantprovisioning.start.config.bean;

import com.acme.persimmon.demo.tenantprovisioning.app.common.id.UuidV7Generator;
import com.acme.persimmon.demo.tenantprovisioning.infra.common.id.UuidV7Generators;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class IdWiringConfig {

  @Bean
  public UuidV7Generator uuidV7Generator() {
    return new UuidV7Generators();
  }
}
