/**
 * Scheduled jobs for the {@code biz} context (optional).
 *
 * <p>Jobs are entry points invoked by the scheduler. They should delegate to application commands/
 * queries and remain thin. Ensure job execution is safe under retries and concurrent triggers.
 *
 * <p><strong>Optional:</strong> use when implementing background processing for {@code biz}.
 */
package com.acme.persimmon.demo.tenantprovisioning.adapter.scheduler.biz.job;
