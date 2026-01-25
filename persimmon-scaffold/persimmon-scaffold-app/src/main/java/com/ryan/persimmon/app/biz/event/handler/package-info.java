/**
 * Application event handlers for the {@code biz} context.
 *
 * <p>Handlers react to domain or integration events and execute follow-up use cases such as updating
 * read models or triggering compensating actions.</p>
 *
 * <h2>Usage</h2>
 * <ul>
 *   <li>Handlers should be idempotent where possible.</li>
 *   <li>Keep them focused on orchestration; delegate business rules to the domain.</li>
 * </ul>
 */
package com.ryan.persimmon.app.biz.event.handler;

