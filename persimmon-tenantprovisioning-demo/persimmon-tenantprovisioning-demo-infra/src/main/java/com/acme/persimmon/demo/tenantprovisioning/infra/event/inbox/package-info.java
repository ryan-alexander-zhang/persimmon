/**
 * Inbox pattern infrastructure (idempotent consumption).
 *
 * <p>Stores consumed integration event IDs to ensure at-least-once delivery does not lead to
 * duplicate business side effects.
 */
package com.acme.persimmon.demo.tenantprovisioning.infra.event.inbox;
