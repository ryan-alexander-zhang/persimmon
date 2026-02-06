/**
 * Domain services for the {@code biz} context.
 *
 * <p>Domain services model business operations that do not naturally fit into a single entity or
 * aggregate. They should be stateless and contain domain logic only.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Prefer moving logic into the model first; use services when necessary.
 *   <li>Services may coordinate multiple aggregates via domain ports.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.domain.biz.service;
