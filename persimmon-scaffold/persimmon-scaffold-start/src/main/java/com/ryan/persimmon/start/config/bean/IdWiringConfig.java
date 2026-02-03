package com.ryan.persimmon.start.config.bean;

import com.ryan.persimmon.app.common.id.UuidV7Generator;
import com.ryan.persimmon.infra.common.id.UuidV7Generators;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class IdWiringConfig {

  @Bean
  public UuidV7Generator uuidV7Generator() {
    return new UuidV7Generators();
  }
}
