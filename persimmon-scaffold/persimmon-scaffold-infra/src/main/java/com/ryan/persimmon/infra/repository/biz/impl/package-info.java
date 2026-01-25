/**
 * Domain repository port implementations for the {@code biz} context.
 *
 * <p>Implements {@code com.ryan.persimmon.domain.biz.repository.*} using infrastructure components
 * such as mappers/JPA repositories and converters.</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Return and accept domain aggregates/value objects, not POs.</li>
 *   <li>Handle persistence exceptions and translate them into appropriate application/domain failures.</li>
 * </ul>
 */
package com.ryan.persimmon.infra.repository.biz.impl;

