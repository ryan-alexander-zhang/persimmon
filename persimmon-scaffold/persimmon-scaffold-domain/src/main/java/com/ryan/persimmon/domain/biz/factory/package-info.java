/**
 * Factories for the {@code biz} context.
 *
 * <p>Factories build complex aggregates/entities/value objects when creation requires multiple
 * steps, validation, or collaboration with other domain components. Keeping creation logic in a
 * factory can reduce duplication and prevent partially-initialized objects.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Use factories for non-trivial construction logic.
 *   <li>Keep factories in the domain; avoid infrastructural concerns.
 * </ul>
 */
package com.ryan.persimmon.domain.biz.factory;
