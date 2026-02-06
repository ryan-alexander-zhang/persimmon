/**
 * Shared web adapter components (global inbound concerns).
 *
 * <p>This is the only shared inbound package in the adapter module. Typical contents include:
 *
 * <ul>
 *   <li>Global exception handling and error response mapping
 *   <li>Authentication/authorization interceptors/filters
 *   <li>Request validation integration and common web utilities
 * </ul>
 *
 * <h2>Usage</h2>
 *
 * <ul>
 *   <li>Do not put business-specific controllers or DTOs here.
 *   <li>Keep dependencies and responsibilities aligned with inbound delivery concerns only.
 * </ul>
 */
package com.acme.persimmon.demo.tenantprovisioning.adapter.web.common;
