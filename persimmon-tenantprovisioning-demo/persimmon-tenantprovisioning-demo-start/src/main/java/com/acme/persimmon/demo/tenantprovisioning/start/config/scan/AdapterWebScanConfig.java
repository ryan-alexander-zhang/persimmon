package com.acme.persimmon.demo.tenantprovisioning.start.config.scan;

import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

/**
 * Enables Web controllers and limits component scanning to adapter web packages only.
 *
 * <p>This keeps the default application component scan narrow while still allowing REST endpoints
 * to run.
 */
@Configuration
@ComponentScan(basePackages = {"com.acme.persimmon.demo.tenantprovisioning.adapter.web"})
public class AdapterWebScanConfig {}

