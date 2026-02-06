/**
 * Event publishers for the {@code biz} context.
 *
 * <p>Publishers emit application/integration events based on completed use cases. They should be
 * invoked by application services/handlers, not directly by inbound adapters.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Keep publishing semantics explicit (synchronous vs async, transactional vs outbox).
 *   <li>Do not embed messaging client code here; keep technical details in infra.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.app.biz.event.publisher;
