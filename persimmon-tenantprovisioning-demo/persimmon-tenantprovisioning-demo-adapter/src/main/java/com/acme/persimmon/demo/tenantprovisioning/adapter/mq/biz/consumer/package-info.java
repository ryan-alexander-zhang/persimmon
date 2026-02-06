/**
 * MQ consumers for the {@code biz} context (optional).
 *
 * <p>Consumers act as inbound adapters. They translate messages into application commands/queries
 * and handle idempotency, retries, and error reporting as required by the chosen messaging
 * infrastructure.
 *
 * <p><strong>Optional:</strong> use when implementing event-driven workflows for {@code biz}.
 */
package com.acme.persimmon.demo.tenantprovisioning.adapter.mq.biz.consumer;
