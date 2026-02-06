package com.acme.persimmon.demo.tenantprovisioning.start.config.scan;

import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;

/**
 * Enables MQ consumers and limits component scanning to adapter MQ packages only.
 *
 * <p>This keeps the default application component scan narrow while still allowing MQ consumers to
 * run.
 */
@Configuration
@EnableKafka
@ComponentScan(basePackages = {"com.acme.persimmon.demo.tenantprovisioning.adapter.mq"})
public class AdapterMqScanConfig {}
