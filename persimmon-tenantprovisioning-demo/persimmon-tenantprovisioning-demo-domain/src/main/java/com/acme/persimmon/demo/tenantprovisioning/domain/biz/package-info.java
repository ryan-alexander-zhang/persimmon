/**
 * Business context root for the domain model.
 *
 * <p>All domain concepts that carry business meaning belong under this package. This repository
 * uses a single placeholder business context name {@code biz} for scaffolding; in a real project,
 * you typically replace it with the actual bounded context name (for example: {@code order}, {@code
 * user}, {@code inventory}).
 *
 * <h2>What belongs here</h2>
 *
 * <ul>
 *   <li>Aggregates/entities/value objects and their invariants
 *   <li>Domain services, policies, specifications
 *   <li>Domain events and factories
 *   <li>Domain-level ports (repositories/gateways) and domain exceptions
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.domain.biz;
