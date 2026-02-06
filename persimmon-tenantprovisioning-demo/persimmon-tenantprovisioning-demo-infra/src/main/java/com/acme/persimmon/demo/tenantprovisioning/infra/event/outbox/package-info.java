/**
 * Outbox pattern infrastructure (optional).
 *
 * <p>Hosts outbox table access, polling, and publication mechanics (implementation-specific). This
 * package supports reliable event publishing with transactional guarantees.
 *
 * <p><strong>Optional:</strong> use when you need exactly-once or at-least-once event publishing
 * with transactional consistency.
 */
package com.acme.persimmon.demo.tenantprovisioning.infra.event.outbox;
