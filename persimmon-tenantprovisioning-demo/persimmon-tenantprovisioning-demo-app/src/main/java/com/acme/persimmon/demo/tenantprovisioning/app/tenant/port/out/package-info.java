/**
 * Outbound ports (optional) for the {@code biz} application context.
 *
 * <p>This package is an optional place for read-side or application-level outbound interfaces such
 * as {@code *ReadDao} that are consumed by query services. Implementations usually live in infra.
 *
 * <p><strong>Optional:</strong> prefer this package when you want query-side abstractions but do
 * not want to introduce a separate contracts module.
 */
package com.acme.persimmon.demo.tenantprovisioning.app.tenant.port.out;
