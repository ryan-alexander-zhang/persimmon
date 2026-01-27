/**
 * Repository ports for the {@code biz} domain context.
 *
 * <p>This package defines domain-level repository interfaces (ports) used to load and persist
 * aggregates. Implementations belong in the infra module, typically under {@code
 * com.ryan.persimmon.infra.repository.biz.impl}.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Design repository methods around aggregates and domain language.
 *   <li>Avoid exposing persistence-specific concepts (tables, SQL, ORM sessions).
 * </ul>
 */
package com.ryan.persimmon.domain.biz.repository;
