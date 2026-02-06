/**
 * Gateway port implementations for {@code system}.
 *
 * <p>Implements domain gateway ports (e.g. {@code com.acme.persimmon.demo.tenantprovisioning.domain.tenant.gateway.*}) by
 * using clients and integration DTOs defined under {@code infra.gateway.system}.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Translate protocol errors into meaningful domain/application failures.
 *   <li>Keep the domain-facing interface business-oriented.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.infra.gateway.system.impl;
