/**
 * Application exceptions for the {@code biz} context.
 *
 * <p>Exceptions in this package represent use-case level failures (e.g. validation failures,
 * missing resources) and act as a boundary between adapters and the domain model.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Translate domain exceptions into application exceptions when needed for presentation.
 *   <li>Do not leak technical exceptions from infrastructure through the application layer.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.app.tenant.exception;
