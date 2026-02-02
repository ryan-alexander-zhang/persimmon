package com.ryan.persimmon.start.config.scan;

import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables scheduler jobs and limits component scanning to adapter scheduler packages only.
 *
 * <p>This keeps the default application component scan narrow while still allowing scheduled jobs
 * to run.
 */
@Configuration
@EnableScheduling
@ComponentScan(basePackages = {"com.ryan.persimmon.adapter.scheduler"})
public class AdapterSchedulerScanConfig {}
