/**
 * Command handlers for the {@code biz} context.
 *
 * <p>Handlers implement application use cases: they translate command DTOs into domain operations,
 * coordinate repositories and domain services, and manage transactional boundaries.
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Keep handlers thin: push business rules into the domain model.
 *   <li>Orchestrate domain ports; do not call infrastructure implementations directly.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.app.tenant.command.handler;
