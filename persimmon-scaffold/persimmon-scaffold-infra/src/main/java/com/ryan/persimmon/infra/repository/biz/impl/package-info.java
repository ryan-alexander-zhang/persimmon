/**
 * Domain repository port implementations for the {@code biz} context.
 *
 * <p>Implements {@code com.ryan.persimmon.domain.biz.repository.*} using infrastructure components
 * such as mappers/JPA repositories and converters.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Return and accept domain aggregates/value objects, not POs.
 *   <li>Handle persistence exceptions and translate them into appropriate application/domain
 *       failures.
 * </ul>
 */
package com.ryan.persimmon.infra.repository.biz.impl;
