/**
 * Shared, non-business domain abstractions.
 *
 * <p>This package is reserved for cross-cutting, business-agnostic building blocks that are useful
 * across multiple business contexts. Examples include:</p>
 *
 * <ul>
 *   <li>Base types such as {@code AggregateRoot}, {@code EntityBase}, {@code ValueObject}</li>
 *   <li>Domain contracts such as {@code DomainEvent} and identifier primitives</li>
 *   <li>Generic domain exceptions (if you prefer not to keep exceptions per business context)</li>
 * </ul>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Do not put business rules here.</li>
 *   <li>Keep APIs small and stable, because many contexts may depend on them.</li>
 *   <li>Prefer language-level primitives and domain concepts; avoid infrastructure details.</li>
 * </ul>
 */
package com.ryan.persimmon.domain.common;

