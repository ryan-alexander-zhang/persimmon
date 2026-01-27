/**
 * Gateway ports for the {@code biz} domain context.
 *
 * <p>Gateways define domain-facing interfaces for interacting with external systems (e.g. payment,
 * risk, messaging). They are ports that the domain depends on; implementations live in infra (e.g.
 * {@code com.ryan.persimmon.infra.gateway.system.impl}).
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Keep gateway interfaces focused on business intent, not protocol details.
 *   <li>Return domain-friendly value objects or DTOs owned by the domain when appropriate.
 * </ul>
 */
package com.ryan.persimmon.domain.biz.gateway;
