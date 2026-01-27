/**
 * Domain exceptions for the {@code biz} context.
 *
 * <p>Exceptions in this package represent business rule violations or domain-level failures that
 * are meaningful to the model. They should be expressed in domain language and help callers decide
 * how to react (retry, compensate, reject, etc.).
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Throw domain exceptions when invariants cannot be satisfied.
 *   <li>Do not wrap technical exceptions here; keep those in infra.
 * </ul>
 */
package com.ryan.persimmon.domain.biz.exception;
