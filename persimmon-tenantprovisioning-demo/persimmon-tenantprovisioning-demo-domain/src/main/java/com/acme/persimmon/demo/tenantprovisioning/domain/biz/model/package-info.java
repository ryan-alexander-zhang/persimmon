/**
 * Domain model types for the {@code biz} context.
 *
 * <p>This package groups the domain model building blocks (aggregate/entity/value object/enums).
 * Keep business invariants inside the model and expose meaningful behaviors rather than setters.
 *
 * <h2>Guidelines</h2>
 *
 * <ul>
 *   <li>Ensure invariants are enforced at construction and state transitions.
 *   <li>Prefer immutability for value objects.
 *   <li>Do not introduce persistence annotations or mapping concerns here.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.domain.biz.model;
