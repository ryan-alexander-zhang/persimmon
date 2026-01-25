/**
 * Application query services for the {@code biz} context.
 *
 * <p>Query services implement read use cases. They may call query-side ports (DAOs/read gateways)
 * and map results into response DTOs.</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Keep query services side-effect free.</li>
 *   <li>Prefer simple, optimized read paths; avoid loading full aggregates for reads.</li>
 * </ul>
 */
package com.ryan.persimmon.app.biz.query.service;

