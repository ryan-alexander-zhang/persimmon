/**
 * Web-layer assemblers for the {@code biz} context.
 *
 * <p>Assemblers map between HTTP DTOs and application-layer command/query DTOs, and may also map
 * application responses to HTTP response DTOs.</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Keep mapping logic centralized for consistent API behavior.</li>
 *   <li>Avoid mapping directly to domain objects at the web boundary.</li>
 * </ul>
 */
package com.ryan.persimmon.adapter.web.biz.assembler;

