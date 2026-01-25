/**
 * Gateway port implementations for {@code system}.
 *
 * <p>Implements domain gateway ports (e.g. {@code com.ryan.persimmon.domain.biz.gateway.*}) by using
 * clients and integration DTOs defined under {@code infra.gateway.system}.</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Translate protocol errors into meaningful domain/application failures.</li>
 *   <li>Keep the domain-facing interface business-oriented.</li>
 * </ul>
 */
package com.ryan.persimmon.infra.gateway.system.impl;

