package com.acme.persimmon.demo.tenantprovisioning.start.bootstrap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.transaction.annotation.EnableTransactionManagement;

@SpringBootApplication(
    scanBasePackages = {"com.acme.persimmon.demo.tenantprovisioning.start.config", "com.acme.persimmon.demo.tenantprovisioning.start.profile"})
@EnableTransactionManagement
public class Application {

  public static void main(String[] args) {
    SpringApplication.run(Application.class, args);
  }
}
