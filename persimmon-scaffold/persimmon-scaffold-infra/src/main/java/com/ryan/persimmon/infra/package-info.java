/**
 * Infrastructure module root package (outbound adapters and technical details).
 *
 * <p>This module contains implementations of domain ports (repositories/gateways), persistence
 * mapping, external system clients, and technical configurations.</p>
 *
 * <h2>Structure rule</h2>
 * <ul>
 *   <li><strong>BC-first</strong> for persistence/query: {@code infra.repository.biz.*}, {@code infra.query.biz.*}</li>
 *   <li><strong>System-first</strong> for external integrations: {@code infra.gateway.system.*}</li>
 * </ul>
 */
package com.ryan.persimmon.infra;

