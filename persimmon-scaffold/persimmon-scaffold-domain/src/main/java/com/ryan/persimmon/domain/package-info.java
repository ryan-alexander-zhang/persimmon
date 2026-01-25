/**
 * Domain module root package.
 *
 * <p>This module contains pure domain model code: aggregates, entities, value objects, domain services,
 * policies, specifications, domain events, factories, and domain-level ports.</p>
 *
 * <h2>Structure rule</h2>
 * <p><strong>BC-first</strong>: all business-semantic domain types live under a business context package,
 * i.e. {@code com.ryan.persimmon.domain.biz.*}. Only non-business, generic abstractions belong under
 * {@code com.ryan.persimmon.domain.common}.</p>
 *
 * <h2>Dependencies</h2>
 * <ul>
 *   <li>Keep this module independent of frameworks and infrastructure concerns.</li>
 *   <li>Define ports (repositories/gateways) in domain; provide implementations in infra.</li>
 * </ul>
 */
package com.ryan.persimmon.domain;

